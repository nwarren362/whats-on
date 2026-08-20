type RequestPayload = {
  action?: unknown;
  confirmation?: unknown;
};

type MetaPageResponse = {
  id?: string;
  name?: string;
  access_token?: string;
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

  if (payload.action !== "verify" && payload.action !== "publish-test") {
    return json({ error: "Unsupported action" }, 400);
  }

  const pageId = Deno.env.get("META_FACEBOOK_PAGE_ID")?.trim();
  const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN")?.trim();
  if (!pageId || !systemUserToken) {
    console.error("Meta publishing secrets are missing.");
    return json({ error: "Server configuration error" }, 500);
  }

  if (payload.action === "publish-test") {
    if (payload.confirmation !== "PUBLISH TEST POST") {
      return json({ error: "Exact publication confirmation required" }, 400);
    }

    const message = [
      "TEST TECHNIQUE — Agenda Jasmin Cottage",
      "",
      "Ceci est un essai temporaire de publication automatisée. Aucun événement réel n’est annoncé dans ce message.",
      "",
      "https://jasmin-cottage.com/fr/agenda-local",
    ].join("\n");

    const pageTokenEndpoint = new URL(
      `https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}`,
    );
    pageTokenEndpoint.searchParams.set("fields", "id,name,access_token");
    pageTokenEndpoint.searchParams.set("access_token", systemUserToken);

    let pageTokenResponse: Response;
    try {
      pageTokenResponse = await fetch(pageTokenEndpoint, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      console.error("Meta Page-token request failed", error);
      return json({ error: "Could not contact Meta" }, 502);
    }

    let pageTokenData: MetaPageResponse;
    try {
      pageTokenData = await pageTokenResponse.json();
    } catch {
      console.error("Meta returned a non-JSON Page-token response.");
      return json({ error: "Invalid response from Meta" }, 502);
    }

    if (
      !pageTokenResponse.ok ||
      pageTokenData.error ||
      pageTokenData.id !== pageId ||
      !pageTokenData.access_token
    ) {
      console.error("Meta did not provide the required Page token", {
        status: pageTokenResponse.status,
        returnedPageId: pageTokenData.id,
        type: pageTokenData.error?.type,
        code: pageTokenData.error?.code,
        message: pageTokenData.error?.message,
      });
      return json({ error: "Could not obtain Facebook Page access" }, 502);
    }

    const form = new URLSearchParams({
      message,
      access_token: pageTokenData.access_token,
    });

    let publishResponse: Response;
    try {
      publishResponse = await fetch(
        `https://graph.facebook.com/v26.0/${encodeURIComponent(pageId)}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      console.error("Meta test publication request failed", error);
      return json({ error: "Could not contact Meta" }, 502);
    }

    let publishData: { id?: string; error?: MetaPageResponse["error"] };
    try {
      publishData = await publishResponse.json();
    } catch {
      console.error("Meta returned a non-JSON publication response.");
      return json({ error: "Invalid response from Meta" }, 502);
    }

    if (!publishResponse.ok || publishData.error || !publishData.id) {
      console.error("Meta rejected the test publication", {
        status: publishResponse.status,
        type: publishData.error?.type,
        code: publishData.error?.code,
        message: publishData.error?.message,
      });
      return json({ error: "Facebook test publication failed" }, 502);
    }

    return json({
      ok: true,
      post_id: publishData.id,
      message: "Test post published to Facebook.",
    }, 201);
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
