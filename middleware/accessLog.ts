import { Context, Next } from "hono";
import { redactApiKeyFromHeaders } from "../utils/deni/auth";

function requestPath(c: Context): string {
  const url = c.req.url;
  const slash = url.indexOf("/", 8);
  return slash === -1 ? c.req.path : url.slice(slash);
}

function requestUserId(c: Context): string | undefined {
  const fromKeyOnly = c.get("agentUserId") as string | undefined;
  if (fromKeyOnly) return fromKeyOnly;
  const auth = c.get("agentAuth") as { userId?: string } | undefined;
  return auth?.userId;
}

/**
 * Request access log. Includes a redacted API key fingerprint when present
 * (Bearer / x-api-key), never the full secret.
 */
export async function accessLog(c: Context, next: Next): Promise<void> {
  const method = c.req.method;
  const path = requestPath(c);
  const startedAt = Date.now();

  console.log(`<-- ${method} ${path}`);
  await next();

  const extras: string[] = [];
  const userId = requestUserId(c);
  if (userId) extras.push(`user=${userId}`);

  const apiKey = redactApiKeyFromHeaders(
    c.req.header("Authorization"),
    c.req.header("x-api-key"),
  );
  if (apiKey) extras.push(`key=${apiKey}`);

  const extra = extras.length > 0 ? ` ${extras.join(" ")}` : "";
  console.log(
    `--> ${method} ${path} ${c.res.status} ${Date.now() - startedAt}ms${extra}`,
  );
}
