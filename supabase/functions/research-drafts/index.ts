import { createClient } from "npm:@supabase/supabase-js@2";

type DraftInput = {
  source_url?: unknown;
  title?: unknown;
  description?: unknown;
  image_url?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  expires_at?: unknown;
  recurrence_frequency?: unknown;
  recurrence_until?: unknown;
  location_name?: unknown;
  category_slug?: unknown;
  featured?: unknown;
  editor_note?: unknown;
};

type BatchPayload = {
  items?: unknown;
  research_note?: unknown;
};

type NormalizedDraft = {
  sourceUrl: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  startAt: string | null;
  endAt: string | null;
  expiresAt: string | null;
  recurrenceFrequency: "none" | "weekly";
  recurrenceUntil: string | null;
  locationName: string | null;
  categorySlug: string;
  featured: boolean;
  editorNote: string;
};

const MAX_ITEMS = 20;
const ALLOWED_CATEGORY_SLUGS = new Set([
  "evenements",
  "gastronomie-vin",
  "marches",
  "musique-culture",
  "plein-air",
  "festivals-fetes",
  "autre",
]);

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-capture-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function publicUrl(value: unknown, required = false) {
  if (value === null || value === undefined || value === "") return required ? undefined : null;
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryJwtClockSkew<T extends { error: { code?: string } | null }>(operation: () => PromiseLike<T>) {
  let result = await operation();
  if (result.error?.code === "PGRST303") {
    await delay(1_500);
    result = await operation();
  }
  return result;
}

function normalizeDraft(value: unknown, researchNote: string): { draft?: NormalizedDraft; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Item must be an object" };
  const item = value as DraftInput;
  const sourceUrl = publicUrl(item.source_url, true);
  const title = text(item.title, 200);
  const imageUrl = publicUrl(item.image_url);
  const startAt = timestamp(item.start_at);
  const endAt = timestamp(item.end_at);
  const suppliedExpiry = timestamp(item.expires_at);
  const recurrenceUntil = timestamp(item.recurrence_until);
  const recurrenceFrequency = item.recurrence_frequency === "weekly" ? "weekly" :
    item.recurrence_frequency === undefined || item.recurrence_frequency === null || item.recurrence_frequency === "none"
      ? "none"
      : undefined;
  const categorySlug = text(item.category_slug, 80) || "autre";

  if (!sourceUrl) return { error: "A valid source_url is required" };
  if (!title) return { error: "A title is required" };
  if (imageUrl === undefined) return { error: "image_url must be an http(s) URL" };
  if (startAt === undefined || endAt === undefined || suppliedExpiry === undefined || recurrenceUntil === undefined) {
    return { error: "One or more dates are invalid" };
  }
  if (!recurrenceFrequency) return { error: "recurrence_frequency must be none or weekly" };
  if (!ALLOWED_CATEGORY_SLUGS.has(categorySlug)) return { error: `Unknown category_slug: ${categorySlug}` };
  if (startAt && endAt && new Date(endAt) <= new Date(startAt)) return { error: "end_at must be after start_at" };
  if (recurrenceFrequency === "weekly" && (!startAt || !recurrenceUntil)) {
    return { error: "Weekly events require start_at and recurrence_until" };
  }
  if (startAt && recurrenceUntil && new Date(recurrenceUntil) < new Date(startAt)) {
    return { error: "recurrence_until must not be before start_at" };
  }

  let expiresAt = suppliedExpiry ?? endAt;
  if (recurrenceFrequency === "weekly") {
    const firstStart = new Date(startAt!).valueOf();
    const firstEnd = endAt ? new Date(endAt).valueOf() : firstStart + 86_400_000;
    expiresAt = new Date(new Date(recurrenceUntil!).valueOf() + (firstEnd - firstStart)).toISOString();
  }

  const itemNote = text(item.editor_note, 1_000);
  const combinedNote = [
    "Ajouté depuis une recherche approuvée. À vérifier avant publication.",
    researchNote,
    itemNote,
  ].filter(Boolean).join(" ").slice(0, 1_000);

  return {
    draft: {
      sourceUrl,
      title,
      description: text(item.description, 3_000) || null,
      imageUrl,
      startAt,
      endAt,
      expiresAt,
      recurrenceFrequency,
      recurrenceUntil: recurrenceFrequency === "weekly" ? recurrenceUntil : null,
      locationName: text(item.location_name, 200) || null,
      categorySlug,
      featured: item.featured === true,
      editorNote: combinedNote,
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const captureToken = Deno.env.get("CAPTURE_TOKEN");
  if (!captureToken || request.headers.get("X-Capture-Token") !== captureToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: BatchPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > MAX_ITEMS) {
    return json({ error: `items must contain between 1 and ${MAX_ITEMS} records` }, 400);
  }

  const researchNote = text(payload.research_note, 400);
  const normalized = payload.items.map((item) => normalizeDraft(item, researchNote));
  const invalid = normalized
    .map((result, index) => result.error ? { index, error: result.error } : null)
    .filter(Boolean);
  if (invalid.length > 0) return json({ error: "Validation failed", invalid }, 400);

  const drafts = normalized.map((result) => result.draft!);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration error" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [categoryResult, statusResult, duplicateResult] = await Promise.all([
    retryJwtClockSkew(() =>
      supabase.from("categories").select("id,slug").in("slug", [...new Set(drafts.map((draft) => draft.categorySlug))])
    ),
    retryJwtClockSkew(() => supabase.from("statuses").select("id").eq("slug", "draft").single()),
    retryJwtClockSkew(() =>
      supabase.from("events").select("id,title,source_url").in("source_url", drafts.map((draft) => draft.sourceUrl))
    ),
  ]);

  if (categoryResult.error || statusResult.error || duplicateResult.error) {
    console.error("Research draft preparation failed", {
      categories: categoryResult.error,
      status: statusResult.error,
      duplicates: duplicateResult.error,
    });
    return json({ error: "Could not prepare drafts" }, 500);
  }

  const categoryIds = new Map(categoryResult.data.map((category) => [category.slug, category.id]));
  const duplicates = new Map(duplicateResult.data.map((event) => [event.source_url, event]));
  const results: Record<string, unknown>[] = [];
  const rows = [];

  for (const draft of drafts) {
    const duplicate = duplicates.get(draft.sourceUrl);
    if (duplicate) {
      results.push({ source_url: draft.sourceUrl, status: "duplicate", id: duplicate.id, title: duplicate.title });
      continue;
    }
    rows.push({
      title: draft.title,
      description: draft.description,
      start_at: draft.startAt,
      end_at: draft.endAt,
      expires_at: draft.expiresAt,
      recurrence_frequency: draft.recurrenceFrequency,
      recurrence_until: draft.recurrenceUntil,
      location_name: draft.locationName,
      category_id: categoryIds.get(draft.categorySlug),
      status_id: statusResult.data.id,
      source_url: draft.sourceUrl,
      image_url: draft.imageUrl,
      featured: draft.featured,
      editor_note: draft.editorNote,
    });
  }

  if (rows.length > 0) {
    const { data, error } = await supabase.from("events").insert(rows).select("id,title,source_url");
    if (error) {
      console.error("Research draft insert failed", error);
      return json({ error: "Could not save drafts" }, 500);
    }
    for (const event of data) {
      results.push({ source_url: event.source_url, status: "created", id: event.id, title: event.title });
    }
  }

  const created = results.filter((result) => result.status === "created").length;
  const duplicateCount = results.filter((result) => result.status === "duplicate").length;
  return json({
    ok: true,
    created,
    duplicates: duplicateCount,
    results,
    message: `${created} brouillon(s) ajouté(s), ${duplicateCount} doublon(s).`,
  }, created > 0 ? 201 : 200);
});
