import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

/**
 * Admin auth for /admin/*.
 *
 * Prefer a signed httpOnly cookie session (form login at /admin/login).
 * Browser HTTP Basic Auth is intentionally NOT used for navigations — Chrome
 * often caches bad credentials and then spins forever on 401 challenges when
 * revisiting days later.
 *
 * Curl / scripts may still send `Authorization: Basic …`.
 *
 * Env:
 *   ADMIN_USER     (default: "admin")
 *   ADMIN_PASSWORD (required — admin is disabled when unset)
 *   ADMIN_SESSION_DAYS (optional, default 14)
 */

export const ADMIN_SESSION_COOKIE = "flixa_admin_session";
const COOKIE_PATH = "/admin";

function adminUsername(): string {
  return Bun.env.ADMIN_USER?.trim() || "admin";
}

function adminPassword(): string | undefined {
  return Bun.env.ADMIN_PASSWORD;
}

function sessionDays(): number {
  const raw = Bun.env.ADMIN_SESSION_DAYS;
  if (!raw) return 14;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(n, 90);
}

function sessionTtlMs(): number {
  return sessionDays() * 24 * 60 * 60 * 1000;
}

function sessionSecret(): string {
  // Password changes invalidate all sessions.
  return `flixa-admin-v1:${adminPassword() ?? ""}`;
}

async function hmacSha256Base64Url(
  message: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createAdminSessionToken(): Promise<string> {
  const exp = Date.now() + sessionTtlMs();
  const payload = `v1.${exp}`;
  const sig = await hmacSha256Base64Url(payload, sessionSecret());
  return `${payload}.${sig}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expRaw, sig] = parts;
  if (version !== "v1" || !expRaw || !sig) return false;

  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const payload = `${version}.${expRaw}`;
  const expected = await hmacSha256Base64Url(payload, sessionSecret());
  return timingSafeEqualString(sig, expected);
}

export function setAdminSessionCookie(c: Context, token: string): void {
  const maxAge = Math.floor(sessionTtlMs() / 1000);
  const secure =
    c.req.url.startsWith("https://") ||
    Bun.env.ADMIN_COOKIE_SECURE === "true";

  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge,
  });
}

export function clearAdminSessionCookie(c: Context): void {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: COOKIE_PATH });
}

export function verifyAdminCredentials(
  username: string,
  password: string,
): boolean {
  const expectedUser = adminUsername();
  const expectedPass = adminPassword();
  if (!expectedPass) return false;
  return (
    timingSafeEqualString(username, expectedUser) &&
    timingSafeEqualString(password, expectedPass)
  );
}

function parseBasicAuthHeader(
  header: string | undefined,
): { username: string; password: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    return {
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

function isPublicAdminPath(path: string): boolean {
  return path === "/admin/login" || path === "/admin/logout";
}

function prefersHtml(c: Context): boolean {
  const accept = (c.req.header("Accept") || "").toLowerCase();
  const mode = (c.req.header("Sec-Fetch-Mode") || "").toLowerCase();
  const dest = (c.req.header("Sec-Fetch-Dest") || "").toLowerCase();

  if (mode === "navigate" || dest === "document") return true;
  if (accept.includes("text/html")) return true;
  // JSON API clients
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return false;
  }
  // Default: browser-ish GETs without explicit JSON
  return c.req.method === "GET";
}

function loginRedirect(c: Context): Response {
  let next = c.req.path;
  try {
    const url = new URL(c.req.url);
    next = url.pathname + url.search;
  } catch {
    // keep path only
  }
  const safeNext =
    next.startsWith("/admin") && !next.startsWith("/admin/login")
      ? next
      : "/admin/lookup";
  return c.redirect(
    `/admin/login?next=${encodeURIComponent(safeNext)}`,
    302,
  );
}

/**
 * Protect /admin/* with cookie session (and optional Basic for scripts).
 */
export const adminAuth: MiddlewareHandler = async (c: Context, next: Next) => {
  const password = adminPassword();
  if (!password) {
    return c.text(
      "Admin is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USER).",
      503,
    );
  }

  if (isPublicAdminPath(c.req.path)) {
    await next();
    return;
  }

  const cookieToken = getCookie(c, ADMIN_SESSION_COOKIE);
  if (await verifyAdminSessionToken(cookieToken)) {
    await next();
    return;
  }

  const basic = parseBasicAuthHeader(c.req.header("Authorization"));
  if (basic && verifyAdminCredentials(basic.username, basic.password)) {
    // Upgrade browser/scripts to a session so later navigations do not rely on
    // sticky Basic credentials (which cause infinite 401 spinners in Chrome).
    const token = await createAdminSessionToken();
    setAdminSessionCookie(c, token);
    await next();
    return;
  }

  if (prefersHtml(c)) {
    return loginRedirect(c);
  }

  return c.json(
    {
      error: {
        message: "Admin authentication required. Open /admin/login or send Basic credentials.",
        type: "authentication_error",
        param: null,
        code: "admin_unauthorized",
      },
    },
    401,
  );
};

/** @deprecated Use adminAuth — kept as alias for older imports. */
export const adminBasicAuth = adminAuth;
