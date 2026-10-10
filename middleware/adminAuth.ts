import { getRequestClientIp } from "../utils/clientIp";
import { checkAdminLoginRateLimit } from "./rateLimit";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  failedLoginDelay,
  isAdminIpAllowed,
  isAdminIpAllowlistEnabled,
  logAdminAudit,
  verifyAdminCredentialsSecure,
} from "../utils/adminSecurity";
import { isAuthDisabledMode } from "../utils/authMode";

/**
 * Admin auth for /admin/*.
 *
 * Prefer a signed httpOnly cookie session (form login at /admin/login).
 * Browser HTTP Basic Auth is intentionally NOT used for navigations — Chrome
 * often caches bad credentials and then spins forever on 401 challenges when
 * revisiting days later.
 *
 * Curl / scripts may still send `Authorization: Basic …` unless
 * ADMIN_ALLOW_BASIC=false.
 *
 * Env:
 *   ADMIN_USER            (default: "admin")
 *   ADMIN_PASSWORD        (required — admin disabled when unset)
 *   ADMIN_SESSION_DAYS    (default: 7, max 30)
 *   ADMIN_COOKIE_SECURE   (force Secure cookies)
 *   ADMIN_IP_ALLOWLIST    (comma-separated IPs / IPv4 CIDRs)
 *   ADMIN_ALLOW_BASIC     (default true; set false to disable Basic)
 */

export const ADMIN_SESSION_COOKIE = "flixa_admin_session";
const COOKIE_PATH = "/admin";

function adminUsername(): string {
  return process.env.ADMIN_USER?.trim() || "admin";
}

function adminPassword(): string | undefined {
  return process.env.ADMIN_PASSWORD;
}

function sessionDays(): number {
  const raw = process.env.ADMIN_SESSION_DAYS;
  if (!raw) return 7;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(n, 30);
}

function sessionTtlMs(): number {
  return sessionDays() * 24 * 60 * 60 * 1000;
}

function sessionSecret(): string {
  // Password changes invalidate all sessions.
  return `flixa-admin-v1:${adminPassword() ?? ""}`;
}

function isBasicAuthAllowed(): boolean {
  const raw = process.env.ADMIN_ALLOW_BASIC?.toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

function requestIsHttps(c: Context): boolean {
  if (c.req.url.startsWith("https://")) return true;
  const proto = (
    c.req.header("x-forwarded-proto") ||
    c.req.header("x-forwarded-protocol") ||
    ""
  )
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (proto === "https") return true;
  if (process.env.ADMIN_COOKIE_SECURE === "true") return true;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ADMIN_COOKIE_SECURE !== "false"
  ) {
    // Prefer Secure in production unless explicitly disabled for local-prod tests.
    return true;
  }
  return false;
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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const payload = `v2.${exp}.${nonce}`;
  const sig = await hmacSha256Base64Url(payload, sessionSecret());
  return `${payload}.${sig}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  // v2: version.exp.nonce.sig  OR legacy v1: version.exp.sig
  if (parts.length === 4 && parts[0] === "v2") {
    const [version, expRaw, nonce, sig] = parts;
    if (!expRaw || !nonce || !sig) return false;
    const exp = Number.parseInt(expRaw, 10);
    if (!Number.isFinite(exp) || exp <= Date.now()) return false;
    const payload = `${version}.${expRaw}.${nonce}`;
    const expected = await hmacSha256Base64Url(payload, sessionSecret());
    return timingSafeEqualString(sig, expected);
  }

  if (parts.length === 3 && parts[0] === "v1") {
    const [version, expRaw, sig] = parts;
    if (!expRaw || !sig) return false;
    const exp = Number.parseInt(expRaw, 10);
    if (!Number.isFinite(exp) || exp <= Date.now()) return false;
    const payload = `${version}.${expRaw}`;
    const expected = await hmacSha256Base64Url(payload, sessionSecret());
    return timingSafeEqualString(sig, expected);
  }

  return false;
}

export function setAdminSessionCookie(c: Context, token: string): void {
  const maxAge = Math.floor(sessionTtlMs() / 1000);
  const secure = requestIsHttps(c);

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

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const expectedUser = adminUsername();
  const expectedPass = adminPassword();
  if (!expectedPass) return false;
  return verifyAdminCredentialsSecure(
    username,
    password,
    expectedUser,
    expectedPass,
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
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return false;
  }
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

function applyAdminSecurityHeaders(c: Context): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function ipDeniedResponse(c: Context, ip: string): Response {
  logAdminAudit("ip_denied", { ip, path: c.req.path });
  if (prefersHtml(c)) {
    return c.text(
      "Admin access is not allowed from this IP. Set ADMIN_IP_ALLOWLIST if this is unexpected.",
      403,
    );
  }
  return c.json(
    {
      error: {
        message: "Admin access denied from this IP",
        type: "authentication_error",
        param: null,
        code: "admin_ip_denied",
      },
    },
    403,
  );
}

/**
 * Protect /admin/* with cookie session (and optional Basic for scripts).
 */
export const adminAuth: MiddlewareHandler = async (c: Context, next: Next) => {
  applyAdminSecurityHeaders(c);

  if (isAuthDisabledMode()) {
    await next();
    return;
  }

  const password = adminPassword();
  if (!password) {
    return c.text(
      "Admin is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USER).",
      503,
    );
  }

  const ip = getRequestClientIp(c);

  // Allowlist applies to all admin routes including login (login is public auth-wise
  // but still IP-gated when configured).
  if (isAdminIpAllowlistEnabled() && !isAdminIpAllowed(ip)) {
    return ipDeniedResponse(c, ip);
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

  if (isBasicAuthAllowed()) {
    const basic = parseBasicAuthHeader(c.req.header("Authorization"));
    if (basic) {
      const limited = await checkAdminLoginRateLimit(c);
      if (limited) return limited;
      const ok = await verifyAdminCredentials(basic.username, basic.password);
      if (ok) {
        const token = await createAdminSessionToken();
        setAdminSessionCookie(c, token);
        logAdminAudit("basic_ok", { ip, path: c.req.path });
        await next();
        return;
      }
      await failedLoginDelay();
      logAdminAudit("login_failed", {
        ip,
        path: c.req.path,
        username: basic.username,
        reason: "basic",
      });
    }
  }

  if (prefersHtml(c)) {
    return loginRedirect(c);
  }

  logAdminAudit("unauthorized", { ip, path: c.req.path });
  return c.json(
    {
      error: {
        message:
          "Admin authentication required. Open /admin/login or send Basic credentials.",
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
