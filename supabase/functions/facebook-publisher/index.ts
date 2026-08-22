import { createClient } from "npm:@supabase/supabase-js@2";

type RequestPayload = {
  action?: unknown;
  event_id?: unknown;
  message?: unknown;
  confirmation?: unknown;
};

type MetaError = {
  message?: string;
  type?: string;
  code?: number;
};

type MetaPageResponse = {
  id?: string;
  name?: string;
  access_token?: string;
  error?: MetaError;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function facebookPostUrl(postId: string) {
  const [pageId, pagePostId] = postId.split("_");
  return pageId && pagePostId
    ? `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(pagePostId)}`
    : `https://www.facebook.com/${encodeURIComponent(postId)}`;
}

async function getPageAccess(pageId: string, systemUserToken: string) {
  const endpoint = new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}`);
  endpoint.searchParams.set("fields", "id,name,access_token");
  endpoint.searchParams.set("access_token", systemUserToken);

  let response: Response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error("Meta Page-token request failed", error);
    return { error: json({ error: "Could not contact Meta" }, 502) };
  }

  let data: MetaPageResponse;
  try {
    data = await response.json();
  } catch {
    console.error("Meta returned a non-JSON Page-token response.");
    return { error: json({ error: "Invalid response from Meta" }, 502) };
  }

  if (!response.ok || data.error || data.id !== pageId || !data.name || !data.access_token) {
    console.error("Meta did not provide the required Page access", {
      status: response.status,
      returnedPageId: data.id,
      type: data.error?.type,
      code: data.error?.code,
      message: data.error?.message,
    });
    return { error: json({ error: "Facebook Page authentication failed" }, 502) };
  }

  return { page: { id: data.id, name: data.name, accessToken: data.access_token } };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const captureToken = Deno.env.get("CAPTURE_TOKEN");
  if (!captureToken || request.headers.get("X-Capture-Token") !== captureToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: RequestPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (payload.action !== "verify" && payload.action !== "publish-event") {
    return json({ error: "Unsupported action" }, 400);
  }

  const pageId = Deno.env.get("META_FACEBOOK_PAGE_ID")?.trim();
  const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN")?.trim();
  if (!pageId || !systemUserToken) {
    console.error("Meta publishing secrets are missing.");
    return json({ error: "Server configuration error" }, 500);
  }

  const pageAccess = await getPageAccess(pageId, systemUserToken);
  if (pageAccess.error) return pageAccess.error;

  if (payload.action === "verify") {
    return json({
      ok: true,
      page: { id: pageAccess.page!.id, name: pageAccess.page!.name },
      message: "Facebook connection verified. No post was created.",
    });
  }

  if (payload.confirmation !== "PUBLISH EVENT") {
    return json({ error: "Exact publication confirmation required" }, 400);
  }

  const eventId = typeof payload.event_id === "string" ? payload.event_id : "";
  const message = text(payload.message, 5_000);
  if (!UUID_PATTERN.test(eventId) || !message) {
    return json({ error: "A valid event_id and Facebook message are required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration error" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function rememberPublicationError(eventId: string, error: string) {
    const attemptedAt = new Date().toISOString();
    const { error: saveError } = await supabase.from("events").update({
      facebook_publish_error: error.slice(0, 1_000),
      facebook_publish_attempted_at: attemptedAt,
      updated_at: attemptedAt,
    }).eq("id", eventId).is("facebook_post_id", null);
    if (saveError) console.error("Could not record Facebook publication error", saveError);
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,title,image_url,facebook_post_id,statuses(slug)")
    .eq("id", eventId)
    .single();

  if (eventError || !event) return json({ error: "Event not found" }, 404);
  const eventStatus = Array.isArray(event.statuses) ? event.statuses[0]?.slug : event.statuses?.slug;
  if (eventStatus !== "published") {
    return json({ error: "Only published agenda events can be posted to Facebook" }, 409);
  }
  if (event.facebook_post_id) {
    return json({
      error: "This event has already been published to Facebook",
      post_id: event.facebook_post_id,
      post_url: facebookPostUrl(event.facebook_post_id),
    }, 409);
  }

  let publishData: { id?: string; post_id?: string; error?: MetaError } | null = null;

  if (event.image_url) {
    try {
      const photoResponse = await fetch(
        `https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            url: event.image_url,
            caption: message,
            access_token: pageAccess.page!.accessToken,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const photoData = await photoResponse.json();
      if (photoResponse.ok && !photoData.error && (photoData.post_id || photoData.id)) {
        publishData = photoData;
      } else {
        console.warn("Meta could not publish the event image", {
          status: photoResponse.status,
          type: photoData.error?.type,
          code: photoData.error?.code,
          message: photoData.error?.message,
        });
        const errorMessage = "The image is unavailable to Facebook. Replace or remove the image link, then try again.";
        await rememberPublicationError(eventId, errorMessage);
        return json({ error: errorMessage, needs_attention: true }, 422);
      }
    } catch (error) {
      console.warn("Facebook image publication failed", error);
      const errorMessage = "Facebook could not retrieve the image. Replace or remove the image link, then try again.";
      await rememberPublicationError(eventId, errorMessage);
      return json({ error: errorMessage, needs_attention: true }, 422);
    }
  }

  // A text-only post is intentional only when the event has no image URL.
  if (!publishData && !event.image_url) {
    let publishResponse: Response;
    try {
      publishResponse = await fetch(
        `https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            message,
            access_token: pageAccess.page!.accessToken,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      console.error("Meta event publication request failed", error);
      const errorMessage = "Could not contact Meta";
      await rememberPublicationError(eventId, errorMessage);
      return json({ error: errorMessage, needs_attention: true }, 502);
    }

    try {
      publishData = await publishResponse.json();
    } catch {
      console.error("Meta returned a non-JSON publication response.");
      const errorMessage = "Invalid response from Meta";
      await rememberPublicationError(eventId, errorMessage);
      return json({ error: errorMessage, needs_attention: true }, 502);
    }

    if (!publishResponse.ok || publishData?.error || !publishData?.id) {
      console.error("Meta rejected the event publication", {
        status: publishResponse.status,
        type: publishData?.error?.type,
        code: publishData?.error?.code,
        message: publishData?.error?.message,
      });
      const errorMessage = "Facebook publication failed";
      await rememberPublicationError(eventId, errorMessage);
      return json({ error: errorMessage, needs_attention: true }, 502);
    }
  }

  const publishedPostId = publishData.post_id || publishData.id;
  if (!publishedPostId) {
    console.error("Meta rejected the event publication", {
      type: publishData.error?.type,
      code: publishData.error?.code,
      message: publishData.error?.message,
    });
    return json({ error: "Facebook publication failed" }, 502);
  }

  const publishedAt = new Date().toISOString();
  const { data: savedEvent, error: saveError } = await supabase
    .from("events")
    .update({
      facebook_message: message,
      facebook_post_id: publishedPostId,
      facebook_published_at: publishedAt,
      facebook_publish_error: null,
      facebook_publish_attempted_at: publishedAt,
      updated_at: publishedAt,
    })
    .eq("id", eventId)
    .is("facebook_post_id", null)
    .select("id,facebook_post_id,facebook_published_at,facebook_publish_error,facebook_publish_attempted_at")
    .single();

  if (saveError || !savedEvent) {
    console.error("Facebook post was created but could not be recorded", {
      eventId,
      postId: publishedPostId,
      saveError,
    });
    return json({
      error: "The Facebook post was created but could not be recorded",
      post_id: publishedPostId,
      post_url: facebookPostUrl(publishedPostId),
    }, 500);
  }

  return json({
    ok: true,
    event: savedEvent,
    post_id: publishedPostId,
    post_url: facebookPostUrl(publishedPostId),
    message: `« ${event.title} » a été publié sur Facebook.`,
  }, 201);
});
