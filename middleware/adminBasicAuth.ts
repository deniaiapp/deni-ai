import type { Context, MiddlewareHandler, Next } from "hono";
import { basicAuth } from "hono/basic-auth";

/**
 * HTTP Basic Auth for /admin/* routes.
 *
 * Env:
 *   ADMIN_USER     (default: "admin")
 *   ADMIN_PASSWORD (required — admin is disabled when unset)
 */
export const adminBasicAuth: MiddlewareHandler = async (
  c: Context,
  next: Next,
) => {
  const password = Bun.env.ADMIN_PASSWORD;
  if (!password) {
    return c.text(
      "Admin is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USER).",
      503,
    );
  }

  const username = Bun.env.ADMIN_USER?.trim() || "admin";
  const auth = basicAuth({
    username,
    password,
    realm: "Flixa Admin",
  });

  return auth(c, next);
};
