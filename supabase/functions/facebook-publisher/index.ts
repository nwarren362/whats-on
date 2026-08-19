type RequestPayload = {
  action?: unknown;
};

type MetaPageResponse = {
  id?: string;
  name?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-capture-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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

  if (payload.action !== "verify") {
    return json({ error: "Unsupported action" }, 400);
  }

  const pageId = Deno.env.get("META_FACEBOOK_PAGE_ID")?.trim();
  const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN")?.trim();
  if (!pageId || !systemUserToken) {
    console.error("Meta publishing secrets are missing.");
    return json({ error: "Server configuration error" }, 500);
  }

  const endpoint = new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}`);
  endpoint.searchParams.set("fields", "id,name");
  endpoint.searchParams.set("access_token", systemUserToken);

  let response: Response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error("Meta verification request failed", error);
    return json({ error: "Could not contact Meta" }, 502);
  }

  let data: MetaPageResponse;
  try {
    data = await response.json();
  } catch {
    console.error("Meta returned a non-JSON verification response.");
    return json({ error: "Invalid response from Meta" }, 502);
  }

  if (!response.ok || data.error) {
    console.error("Meta rejected the verification request", {
      status: response.status,
      type: data.error?.type,
      code: data.error?.code,
      message: data.error?.message,
    });
    return json({ error: "Meta authentication failed" }, 502);
  }

  if (data.id !== pageId || !data.name) {
    console.error("Meta returned an unexpected Page identity", {
      expectedPageId: pageId,
      returnedPageId: data.id,
      returnedName: data.name,
    });
    return json({ error: "Unexpected Facebook Page identity" }, 502);
  }

  return json({
    ok: true,
    page: {
      id: data.id,
      name: data.name,
    },
    message: "Facebook connection verified. No post was created.",
  });
});
