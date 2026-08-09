import { createClient } from "npm:@supabase/supabase-js@2";

const COOKIE_NAME = "jasmin_admin";
const COOKIE_PATH = "/functions/v1/manage-events";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-capture-token",
  "Access-Control-Allow-Methods": "GET, PATCH, POST, OPTIONS",
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
        .select("id,title,description,start_at,end_at,expires_at,location_name,category_id,status_id,source_url,image_url,featured,editor_note,created_at,updated_at,categories(name,slug),statuses(name,slug)")
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
    const startAt = nullableTimestamp(body.start_at);
    const endAt = nullableTimestamp(body.end_at);
    const expiresAt = nullableTimestamp(body.expires_at);
    const categoryId = typeof body.category_id === "string" ? body.category_id : "";
    const statusId = typeof body.status_id === "string" ? body.status_id : "";

    if (!title || description === undefined || locationName === undefined ||
      sourceUrl === undefined || imageUrl === undefined || editorNote === undefined ||
      startAt === undefined || endAt === undefined || expiresAt === undefined ||
      !UUID_PATTERN.test(categoryId) || !UUID_PATTERN.test(statusId)) {
      return json({ error: "Veuillez vérifier les champs du formulaire" }, 400);
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
        expires_at: expiresAt,
        location_name: locationName,
        category_id: categoryId,
        status_id: statusId,
        source_url: sourceUrl,
        image_url: imageUrl,
        featured: body.featured === true,
        editor_note: editorNote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .select("id,title")
      .single();

    if (error) {
      console.error("Admin update failed", error);
      return json({ error: "Impossible d’enregistrer l’événement" }, 500);
    }

    return json({ ok: true, event: data, message: "Événement enregistré." });
  }

  return json({ error: "Not found" }, 404);
});
