import { createClient } from "npm:@supabase/supabase-js@2";

type CapturePayload = {
  source_url?: unknown;
  title?: unknown;
  description?: unknown;
  image_url?: unknown;
};

type PageMetadata = {
  title?: string;
  description?: string;
  imageUrl?: string;
  startAt?: string;
  endAt?: string;
  locationName?: string;
};

const MAX_HTML_BYTES = 1_000_000;

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

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function safeUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || isPrivateHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchHtml(sourceUrl: string) {
  let current = safeUrl(sourceUrl);
  if (!current) return null;
  const signal = AbortSignal.timeout(8_000);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; JasminCottageEventBot/1.0)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = safeUrl(location, current.href);
      if (!current) return null;
      continue;
    }

    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_HTML_BYTES) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return { html, finalUrl: current.href };
  }
  return null;
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  }).replace(/\s+/g, " ").trim();
}

function metadataTags(html: string) {
  const values = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
    }
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    if (key && content && !values.has(key)) values.set(key, content);
  }
  return values;
}

function findEventObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEventObject(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some((type) => typeof type === "string" && type.toLowerCase() === "event")) return object;
  return findEventObject(object["@graph"]);
}

function structuredEvent(html: string) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const event = findEventObject(JSON.parse(match[1].trim()));
      if (event) return event;
    } catch {
      // Invalid JSON-LD should not prevent capture.
    }
  }
  return null;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function structuredImage(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return structuredImage(value[0]);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return typeof object.url === "string" ? object.url : typeof object.contentUrl === "string" ? object.contentUrl : undefined;
  }
  return undefined;
}

function structuredLocation(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if (typeof object.name === "string") return object.name;
  if (object.address && typeof object.address === "object") {
    const address = object.address as Record<string, unknown>;
    if (typeof address.addressLocality === "string") return address.addressLocality;
  }
  return undefined;
}

async function extractMetadata(sourceUrl: string): Promise<PageMetadata> {
  try {
    const page = await fetchHtml(sourceUrl);
    if (!page) return {};
    const tags = metadataTags(page.html);
    const event = structuredEvent(page.html);
    const pageTitle = page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const rawImage = structuredImage(event?.image) ?? tags.get("og:image") ?? tags.get("twitter:image");
    const image = rawImage ? safeUrl(rawImage, page.finalUrl)?.href : undefined;
    return {
      title: textValue(event?.name, 200) || textValue(tags.get("og:title"), 200) || textValue(pageTitle ? decodeHtml(pageTitle) : "", 200) || undefined,
      description: textValue(event?.description, 3_000) || textValue(tags.get("og:description"), 3_000) || textValue(tags.get("description"), 3_000) || undefined,
      imageUrl: image,
      startAt: timestamp(event?.startDate),
      endAt: timestamp(event?.endDate),
      locationName: textValue(structuredLocation(event?.location), 200) || undefined,
    };
  } catch (error) {
    console.warn("Metadata extraction failed", error instanceof Error ? error.message : error);
    return {};
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

  const metadata = await extractMetadata(sourceUrl);
  const title = textValue(payload.title, 200) || metadata.title || "Lien à examiner";
  const description = textValue(payload.description, 3_000) || metadata.description || null;
  const suppliedImage = parsePublicUrl(payload.image_url);
  const imageUrl = suppliedImage || metadata.imageUrl || null;

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
      description,
      start_at: metadata.startAt ?? null,
      end_at: metadata.endAt ?? null,
      expires_at: metadata.endAt ?? null,
      location_name: metadata.locationName ?? null,
      source_url: sourceUrl,
      image_url: imageUrl,
      category_id: categoryResult.data.id,
      status_id: statusResult.data.id,
      editor_note: metadata.title || metadata.description || metadata.startAt || metadata.imageUrl
        ? "Ajouté via le raccourci de partage et prérempli automatiquement. À vérifier avant publication."
        : "Ajouté via le raccourci de partage. Les métadonnées n’étaient pas disponibles.",
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
