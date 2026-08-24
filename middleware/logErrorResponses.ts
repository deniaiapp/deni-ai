import { Context, Next } from "hono";
import { redactApiKeyFromHeaders } from "../utils/deni/auth";

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
  const auth = c.get("agentAuth") as { userId?: string } | undefined;
  const userId =
    (c.get("agentUserId") as string | undefined) || auth?.userId || null;

  console.error("[http_error_response]", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
    contentType: c.res.headers.get("content-type"),
    userId,
    apiKey: redactApiKeyFromHeaders(
      c.req.header("Authorization"),
      c.req.header("x-api-key"),
    ),
    responseBody,
  });
}
