import { Context, Next } from "hono";

const MAX_LOGGED_BODY_LENGTH = 2_000;

function truncate(value: string, maxLength = MAX_LOGGED_BODY_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated]`;
}

async function getResponseBodyPreview(c: Context): Promise<string | null> {
  const contentType = c.res.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("text/event-stream") ||
    (!contentType.includes("application/json") &&
      !contentType.startsWith("text/"))
  ) {
    return null;
  }

  try {
    const body = await c.res.clone().text();
    return body ? truncate(body) : null;
  } catch {
    return null;
  }
}

export async function logErrorResponses(c: Context, next: Next): Promise<void> {
  const startedAt = Date.now();

  await next();

  if (c.res.status < 400 || c.res.status == 404) {
    return;
  }

  // Browser Basic Auth: first hit without Authorization is expected 401 with
  // WWW-Authenticate. Logging it as an error looks like a bug and confuses
  // debugging when the admin UI is still prompting for credentials.
  if (
    c.res.status === 401 &&
    c.res.headers.has("www-authenticate")
  ) {
    return;
  }

  const responseBody = await getResponseBodyPreview(c);

  console.error("[http_error_response]", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
    contentType: c.res.headers.get("content-type"),
    responseBody,
  });
}
