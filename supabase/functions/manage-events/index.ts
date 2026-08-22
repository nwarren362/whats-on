import { createClient } from "npm:@supabase/supabase-js@2";

const COOKIE_NAME = "jasmin_admin";
const COOKIE_PATH = "/functions/v1/manage-events";
const API_VERSION = "source-lifecycle-v1";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-capture-token",
  "Access-Control-Allow-Methods": "DELETE, GET, PATCH, POST, OPTIONS",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const cookie of cookies.split(";")) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

async function isAuthenticated(request: Request, captureToken: string) {
  const headerToken = request.headers.get("X-Capture-Token") ?? "";
  if (headerToken === captureToken) return true;
  const supplied = readCookie(request, COOKIE_NAME);
  return supplied.length > 0 && supplied === await digest(captureToken);
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function nullableText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" ? value.trim().slice(0, maxLength) || null : undefined;
}

function nullableTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname.replace(/\/+$/, "");
  const captureToken = Deno.env.get("CAPTURE_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (!captureToken || !supabaseUrl || !serviceRoleKey) {
    console.error("Required environment variables are missing.");
    return json({ error: "Server configuration error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (pathname.endsWith("/session") && request.method === "POST") {
    if (!isSameOrigin(request)) return json({ error: "Forbidden" }, 403);
    let token = "";
    try {
      const body = await request.json();
      token = typeof body.token === "string" ? body.token : "";
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    if (token !== captureToken) return json({ error: "Token incorrect" }, 401);

    const session = await digest(captureToken);
    return json({ ok: true }, 200, {
      "Set-Cookie": `${COOKIE_NAME}=${session}; Path=${COOKIE_PATH}; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (pathname.endsWith("/logout") && request.method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": `${COOKIE_NAME}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  const authenticated = await isAuthenticated(request, captureToken);

  if (pathname.includes("/api/") && !authenticated) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (pathname.endsWith("/api/events") && request.method === "GET") {
    const [eventsResult, categoriesResult, statusesResult] = await Promise.all([
      supabase
        .from("events")
        .select("id,title,description,start_at,end_at,expires_at,recurrence_frequency,recurrence_until,location_name,category_id,status_id,source_url,image_url,featured,editor_note,facebook_message,facebook_post_id,facebook_published_at,facebook_publish_error,facebook_publish_attempted_at,created_at,updated_at,categories(name,slug),statuses(name,slug)")
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("id,name,slug,sort_order").eq("is_active", true).order("sort_order"),
      supabase.from("statuses").select("id,name,slug,sort_order").order("sort_order"),
    ]);

    if (eventsResult.error || categoriesResult.error || statusesResult.error) {
      console.error("Admin list query failed", {
        events: eventsResult.error,
        categories: categoriesResult.error,
        statuses: statusesResult.error,
      });
      return json({ error: "Impossible de charger les événements" }, 500);
    }

    return json({
      events: eventsResult.data,
      categories: categoriesResult.data,
      statuses: statusesResult.data,
    });
  }

  if (pathname.endsWith("/api/sources") && request.method === "GET") {
    const { data, error } = await supabase
      .from("sources")
      .select("id,name,url,source_type,area,notes,access_notes,priority,lifecycle_status,review_reason,discovered_from_event_id,added_by,last_checked_at,last_useful_at,created_at,updated_at")
      .order("lifecycle_status")
      .order("priority")
      .order("name");
    if (error) {
      console.error("Source list query failed", error);
      return json({ error: "Impossible de charger les sources" }, 500);
    }
    return json({ sources: data, version: API_VERSION });
  }

  if (pathname.endsWith("/api/sources") && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const source = validateSource(body);
    if ("error" in source) return json({ error: source.error }, 400);
    const { data, error } = await supabase.from("sources").insert(source.value).select().single();
    if (error?.code === "23505") return json({ error: "Cette adresse existe déjà dans les sources" }, 409);
    if (error) {
      console.error("Source insert failed", error);
      return json({ error: "Impossible d’ajouter la source" }, 500);
    }
    return json({ ok: true, source: data, message: "Source ajoutée." }, 201);
  }

  const sourceMatch = pathname.match(/\/api\/sources\/([0-9a-f-]+)$/i);
  if (sourceMatch && request.method === "PATCH") {
    if (!UUID_PATTERN.test(sourceMatch[1])) return json({ error: "Invalid source id" }, 400);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const source = validateSource(body);
    if ("error" in source) return json({ error: source.error }, 400);
    const { data, error } = await supabase.from("sources")
      .update({ ...source.value, updated_at: new Date().toISOString() })
      .eq("id", sourceMatch[1]).select().single();
    if (error?.code === "23505") return json({ error: "Cette adresse existe déjà dans les sources" }, 409);
    if (error) {
      console.error("Source update failed", error);
      return json({ error: "Impossible d’enregistrer la source" }, 500);
    }
    return json({ ok: true, source: data, message: "Source enregistrée." });
  }

  if (sourceMatch && request.method === "DELETE") {
    if (!UUID_PATTERN.test(sourceMatch[1])) return json({ error: "Invalid source id" }, 400);
    const { data: source, error: sourceError } = await supabase.from("sources")
      .select("id,name,url,discovered_from_event_id")
      .eq("id", sourceMatch[1])
      .single();
    if (sourceError) return json({ error: "Source introuvable" }, 404);

    if (source.discovered_from_event_id) {
      const { data: originatingEvent, error: eventLookupError } = await supabase.from("events")
        .select("source_url")
        .eq("id", source.discovered_from_event_id)
        .single();
      if (eventLookupError) {
        console.error("Could not read the originating event", eventLookupError);
        return json({ error: "Impossible de retrouver l’événement d’origine" }, 500);
      }
      const { error: ignoreError } = await supabase.from("events")
        .update({ source_tracking_ignored_url: originatingEvent.source_url || source.url, updated_at: new Date().toISOString() })
        .eq("id", source.discovered_from_event_id);
      if (ignoreError) {
        console.error("Could not preserve rejected source decision", ignoreError);
        return json({ error: "Impossible de mémoriser le rejet de cette source" }, 500);
      }
    }
    const { error: deleteError } = await supabase.from("sources").delete().eq("id", sourceMatch[1]);
    if (deleteError) {
      console.error("Source delete failed", deleteError);
      return json({ error: "Impossible de supprimer la source" }, 500);
    }
    return json({ ok: true, message: `Source « ${source.name} » supprimée.` });
  }

  const imageCheckMatch = pathname.match(/\/api\/events\/([0-9a-f-]+)\/image-check$/i);
  if (imageCheckMatch && request.method === "POST") {
    const eventId = imageCheckMatch[1];
    if (!UUID_PATTERN.test(eventId)) return json({ error: "Invalid event id" }, 400);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const imageUrl = nullableText(body.image_url, 2_000);
    if (imageUrl === undefined) return json({ error: "Invalid image URL" }, 400);
    const checkedAt = new Date().toISOString();
    if (!imageUrl) {
      await supabase.from("events").update({
        facebook_publish_error: null,
        facebook_publish_attempted_at: checkedAt,
        updated_at: checkedAt,
      }).eq("id", eventId).is("facebook_post_id", null);
      return json({ ok: true, status: "no_image", message: "No image supplied" });
    }

    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    } catch {
      return json({ error: "Invalid image URL" }, 400);
    }

    let works = false;
    try {
      const response = await fetch(parsed, {
        headers: { Accept: "image/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      works = response.ok && contentType.startsWith("image/");
      await response.body?.cancel();
    } catch (error) {
      console.warn("Event image check failed", { eventId, error });
    }

    const errorMessage = works ? null : "Image unavailable — replace or remove it before publishing to Facebook.";
    const { error: saveError } = await supabase.from("events").update({
      facebook_publish_error: errorMessage,
      facebook_publish_attempted_at: checkedAt,
      updated_at: checkedAt,
    }).eq("id", eventId).is("facebook_post_id", null);
    if (saveError) {
      console.error("Could not record image check", saveError);
      return json({ error: "Could not record the image check" }, 500);
    }
    return works
      ? json({ ok: true, status: "working", message: "Image is working" })
      : json({ error: errorMessage!, status: "unavailable", needs_attention: true }, 422);
  }

  const eventMatch = pathname.match(/\/api\/events\/([0-9a-f-]+)$/i);
  if (eventMatch && request.method === "PATCH") {
    const eventId = eventMatch[1];
    if (!UUID_PATTERN.test(eventId)) return json({ error: "Invalid event id" }, 400);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const title = nullableText(body.title, 200);
    const description = nullableText(body.description, 3_000);
    const locationName = nullableText(body.location_name, 200);
    const sourceUrl = nullableText(body.source_url, 2_000);
    const imageUrl = nullableText(body.image_url, 2_000);
    const editorNote = nullableText(body.editor_note, 1_000);
    const facebookMessage = nullableText(body.facebook_message, 5_000);
    const startAt = nullableTimestamp(body.start_at);
    const endAt = nullableTimestamp(body.end_at);
    const expiresAt = nullableTimestamp(body.expires_at);
    const recurrenceUntil = nullableTimestamp(body.recurrence_until);
    const recurrenceFrequency = body.recurrence_frequency === "weekly" ? "weekly" :
      body.recurrence_frequency === "none" ? "none" : undefined;
    const categoryId = typeof body.category_id === "string" ? body.category_id : "";
    const statusId = typeof body.status_id === "string" ? body.status_id : "";

    if (!title || description === undefined || locationName === undefined ||
      sourceUrl === undefined || imageUrl === undefined || editorNote === undefined || facebookMessage === undefined ||
      startAt === undefined || endAt === undefined || expiresAt === undefined ||
      recurrenceUntil === undefined || recurrenceFrequency === undefined ||
      !UUID_PATTERN.test(categoryId) || !UUID_PATTERN.test(statusId)) {
      return json({ error: "Veuillez vérifier les champs du formulaire" }, 400);
    }

    if (endAt && startAt && new Date(endAt) <= new Date(startAt)) {
      return json({ error: "La date de fin doit être après la date de début" }, 400);
    }
    if (recurrenceFrequency === "weekly" && (!startAt || !recurrenceUntil)) {
      return json({ error: "Une série hebdomadaire nécessite une date de début et une dernière occurrence" }, 400);
    }
    if (recurrenceFrequency === "weekly" && new Date(recurrenceUntil!) < new Date(startAt!)) {
      return json({ error: "La dernière occurrence doit être après la première" }, 400);
    }

    let effectiveExpiry = expiresAt ?? endAt;
    if (recurrenceFrequency === "weekly") {
      const firstStart = new Date(startAt!).valueOf();
      const firstEnd = endAt ? new Date(endAt).valueOf() : firstStart + 86_400_000;
      effectiveExpiry = new Date(new Date(recurrenceUntil!).valueOf() + (firstEnd - firstStart)).toISOString();
    }

    for (const candidate of [sourceUrl, imageUrl]) {
      if (candidate) {
        try {
          const url = new URL(candidate);
          if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
        } catch {
          return json({ error: "Les liens doivent commencer par http:// ou https://" }, 400);
        }
      }
    }

    const { data, error } = await supabase
      .from("events")
      .update({
        title,
        description,
        start_at: startAt,
        end_at: endAt,
        expires_at: effectiveExpiry,
        recurrence_frequency: recurrenceFrequency,
        recurrence_until: recurrenceFrequency === "weekly" ? recurrenceUntil : null,
        location_name: locationName,
        category_id: categoryId,
        status_id: statusId,
        source_url: sourceUrl,
        image_url: imageUrl,
        featured: body.featured === true,
        editor_note: editorNote,
        facebook_message: facebookMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .select("id,title,source_url,status_id,source_tracking_ignored_url,facebook_message,facebook_post_id,facebook_published_at")
      .single();

    if (error) {
      console.error("Admin update failed", error);
      return json({ error: "Impossible d’enregistrer l’événement" }, 500);
    }

    let message = "Événement enregistré.";
    const { data: selectedStatus, error: statusError } = await supabase
      .from("statuses")
      .select("slug")
      .eq("id", statusId)
      .single();
    if (statusError) {
      console.error("Could not identify saved event status", statusError);
    } else if (selectedStatus.slug === "published" && sourceUrl) {
      try {
        const sourceResult = await syncPublishedSource(supabase, {
          id: eventId,
          title,
          sourceUrl,
          ignoredSourceUrl: typeof data.source_tracking_ignored_url === "string" ? data.source_tracking_ignored_url : null,
        });
        if (sourceResult === "created") message = "Événement enregistré. Nouvelle source à vérifier.";
        if (sourceResult === "matched") message = "Événement enregistré. Source reconnue.";
        if (sourceResult === "ignored") message = "Événement enregistré. Source volontairement ignorée.";
      } catch (sourceError) {
        console.error("Published event source sync failed", sourceError);
        message = "Événement enregistré. La source n’a pas pu être mise à jour.";
      }
    }

    return json({ ok: true, event: data, message });
  }

  return json({ error: "Not found" }, 404);
});

type PublishedEventSource = { id: string; title: string; sourceUrl: string; ignoredSourceUrl: string | null };
type SourceCandidate = {
  url: string;
  matchKey: string;
  sourceType: "facebook_group" | "facebook_page" | "other";
  label: string;
  reviewReason: string;
};

function sourceCandidate(rawUrl: string): SourceCandidate {
  const parsed = new URL(rawUrl);
  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

  if (hostname === "facebook.com") {
    const group = parsed.pathname.match(/^\/groups\/([^/]+)/i);
    if (group) {
      const url = `https://www.facebook.com/groups/${group[1]}`;
      return {
        url,
        matchKey: `facebook:${url.toLowerCase()}`,
        sourceType: "facebook_group",
        label: "Groupe Facebook",
        reviewReason: "Vérifier le nom du groupe, sa zone géographique et son utilité pour les recherches futures.",
      };
    }

    const profilePaths = new Set(["/profile.php", "/permalink.php", "/story.php"]);
    const profileId = profilePaths.has(parsed.pathname.toLowerCase()) ? parsed.searchParams.get("id") : null;
    if (profileId) {
      const url = `https://www.facebook.com/profile.php?id=${encodeURIComponent(profileId)}`;
      return {
        url,
        matchKey: `facebook:${url.toLowerCase()}`,
        sourceType: "facebook_page",
        label: "Page Facebook",
        reviewReason: "Vérifier le nom de la page Facebook, sa zone géographique et son utilité.",
      };
    }

    const page = parsed.pathname.match(/^\/([^/]+)(?:\/(?:posts|photos|videos)\/.*)?\/?$/i);
    const reserved = new Set(["share", "events", "permalink.php", "story.php", "watch", "groups"]);
    if (page && !reserved.has(page[1].toLowerCase())) {
      const url = `https://www.facebook.com/${page[1]}`;
      return {
        url,
        matchKey: `facebook:${url.toLowerCase()}`,
        sourceType: "facebook_page",
        label: "Page Facebook",
        reviewReason: "Vérifier le nom de la page Facebook, sa zone géographique et son utilité.",
      };
    }

    parsed.hostname = "www.facebook.com";
    parsed.search = "";
    const url = parsed.toString().replace(/\/$/, "");
    return {
      url,
      matchKey: `facebook:${url.toLowerCase()}`,
      sourceType: "other",
      label: "Source Facebook",
      reviewReason: "Le lien désigne un partage ou une publication. Remplacer si possible par la page ou le groupe Facebook réutilisable.",
    };
  }

  const url = `${parsed.protocol}//${parsed.host}/`;
  return {
    url,
    matchKey: `website:${hostname}`,
    sourceType: "other",
    label: hostname,
    reviewReason: "Vérifier le nom de l’organisme, le type de source, la zone et l’adresse la plus utile pour les recherches futures.",
  };
}

async function syncPublishedSource(
  supabase: ReturnType<typeof createClient>,
  event: PublishedEventSource,
): Promise<"matched" | "created" | "ignored"> {
  const candidate = sourceCandidate(event.sourceUrl);
  if (event.ignoredSourceUrl) {
    try {
      if (sourceCandidate(event.ignoredSourceUrl).matchKey === candidate.matchKey) return "ignored";
    } catch {
      // An invalid historic value should not block recognition of the current source.
    }
  }
  const { data: sources, error: sourceListError } = await supabase
    .from("sources")
    .select("id,url,discovered_from_event_id");
  if (sourceListError) throw sourceListError;

  const existing = (sources ?? []).find((source) => {
    if (source.discovered_from_event_id === event.id) return true;
    try {
      return sourceCandidate(source.url).matchKey === candidate.matchKey;
    } catch {
      return false;
    }
  });
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await supabase.from("sources")
      .update({ last_useful_at: now, updated_at: now })
      .eq("id", existing.id);
    if (error) throw error;
    return "matched";
  }

  const shortTitle = event.title.length > 90 ? `${event.title.slice(0, 87)}…` : event.title;
  const { error: insertError } = await supabase.from("sources").insert({
    name: `${candidate.label} – ${shortTitle}`.slice(0, 200),
    url: candidate.url,
    source_type: candidate.sourceType,
    area: null,
    notes: `Source ayant fourni l’événement publié « ${shortTitle} ».`.slice(0, 1_000),
    access_notes: candidate.url.includes("facebook.com") ? "Connexion Facebook probablement nécessaire." : null,
    priority: "normal",
    lifecycle_status: "review",
    review_reason: candidate.reviewReason,
    discovered_from_event_id: event.id,
    added_by: "Automatisation",
    last_useful_at: now,
  });
  if (insertError?.code === "23505") return "matched";
  if (insertError) throw insertError;
  return "created";
}

function validateSource(body: Record<string, unknown>): { value: Record<string, unknown> } | { error: string } {
  const name = nullableText(body.name, 200);
  const url = nullableText(body.url, 2_000);
  const area = nullableText(body.area, 200);
  const notes = nullableText(body.notes, 1_000);
  const accessNotes = nullableText(body.access_notes, 500);
  const addedBy = nullableText(body.added_by, 100);
  const reviewReason = nullableText(body.review_reason, 500);
  const lastCheckedAt = nullableTimestamp(body.last_checked_at);
  const lastUsefulAt = nullableTimestamp(body.last_useful_at);
  const discoveredFromEventId = body.discovered_from_event_id === null || body.discovered_from_event_id === undefined || body.discovered_from_event_id === ""
    ? null
    : typeof body.discovered_from_event_id === "string" && UUID_PATTERN.test(body.discovered_from_event_id)
    ? body.discovered_from_event_id
    : undefined;
  const sourceTypes = ["facebook_group", "facebook_page", "mairie", "tourist_office", "organiser", "local_press", "other"];
  const priorities = ["high", "normal", "low"];
  const lifecycleStatuses = ["review", "verified"];
  const sourceType = typeof body.source_type === "string" && sourceTypes.includes(body.source_type) ? body.source_type : "";
  const priority = typeof body.priority === "string" && priorities.includes(body.priority) ? body.priority : "";
  const lifecycleStatus = typeof body.lifecycle_status === "string" && lifecycleStatuses.includes(body.lifecycle_status)
    ? body.lifecycle_status
    : "";
  if (!name || !url || area === undefined || notes === undefined || accessNotes === undefined || addedBy === undefined ||
    reviewReason === undefined || lastCheckedAt === undefined || lastUsefulAt === undefined || discoveredFromEventId === undefined ||
    !sourceType || !priority || !lifecycleStatus) {
    return { error: "Veuillez vérifier les champs de la source" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    return { error: "Le lien doit commencer par http:// ou https://" };
  }
  return { value: {
    name, url, source_type: sourceType, area, notes, access_notes: accessNotes,
    priority, lifecycle_status: lifecycleStatus, added_by: addedBy,
    review_reason: lifecycleStatus === "review" ? reviewReason : null,
    discovered_from_event_id: discoveredFromEventId,
    last_checked_at: lastCheckedAt,
    last_useful_at: lastUsefulAt,
  } };
}
