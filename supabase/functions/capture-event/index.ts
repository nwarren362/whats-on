import { createClient } from "npm:@supabase/supabase-js@2";

type CapturePayload = {
  source_url?: unknown;
  title?: unknown;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function getCaptureToken(request: Request) {
  return request.headers.get("X-Capture-Token") ?? "";
}

function parsePublicUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const captureToken = Deno.env.get("CAPTURE_TOKEN");
  if (!captureToken || getCaptureToken(request) !== captureToken) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: CapturePayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const sourceUrl = parsePublicUrl(payload.source_url);
  if (!sourceUrl) {
    return jsonResponse({ error: "A valid http(s) source_url is required" }, 400);
  }

  const suppliedTitle = typeof payload.title === "string" ? payload.title.trim() : "";
  const title = suppliedTitle.slice(0, 200) || "Lien à examiner";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Required Supabase environment variables are missing.");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: duplicateCheckError } = await supabase
    .from("events")
    .select("id,title")
    .eq("source_url", sourceUrl)
    .limit(1)
    .maybeSingle();

  if (duplicateCheckError) {
    console.error("Duplicate check failed", duplicateCheckError);
    return jsonResponse({ error: "Could not check the link" }, 500);
  }

  if (existing) {
    return jsonResponse({
      ok: true,
      duplicate: true,
      id: existing.id,
      message: "Ce lien existe déjà.",
    });
  }

  const [categoryResult, statusResult] = await Promise.all([
    supabase.from("categories").select("id").eq("slug", "autre").single(),
    supabase.from("statuses").select("id").eq("slug", "draft").single(),
  ]);

  if (categoryResult.error || statusResult.error) {
    console.error("Taxonomy lookup failed", {
      category: categoryResult.error,
      status: statusResult.error,
    });
    return jsonResponse({ error: "Could not prepare the draft" }, 500);
  }

  const { data: event, error: insertError } = await supabase
    .from("events")
    .insert({
      title,
      source_url: sourceUrl,
      category_id: categoryResult.data.id,
      status_id: statusResult.data.id,
      editor_note: "Ajouté via le raccourci de partage.",
    })
    .select("id,title")
    .single();

  if (insertError) {
    console.error("Draft insert failed", insertError);
    return jsonResponse({ error: "Could not save the draft" }, 500);
  }

  return jsonResponse({
    ok: true,
    duplicate: false,
    id: event.id,
    title: event.title,
    message: "Ajouté aux brouillons Jasmin Cottage.",
  }, 201);
});
