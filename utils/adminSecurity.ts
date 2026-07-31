/**
 * Admin security helpers: IP allowlist, password hygiene, audit logs.
 */

import { getClientIp } from "./rateLimit";

const WEAK_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password123",
    "admin",
    "admin123",
    "changeme",
    "letmein",
    "qwerty",
    "123456",
    "12345678",
    "flixa",
    "deni",
    "secret",
  ].map((s) => s.toLowerCase()),
);

/**
 * Comma-separated list of exact IPs or IPv4 CIDR (e.g. `10.0.0.0/8,203.0.113.4`).
 * Empty / unset = allow all.
 */
export function getAdminIpAllowlist(): string[] {
  const raw = Bun.env.ADMIN_IP_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdminIpAllowlistEnabled(): boolean {
  return getAdminIpAllowlist().length > 0;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const o = Number.parseInt(part, 10);
    if (!Number.isFinite(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function matchIpv4Cidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  if (!base || bitsRaw === undefined) return false;
  const bits = Number.parseInt(bitsRaw, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base);
  if (ipN === null || baseN === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

/**
 * Whether `ip` is allowed to use admin when allowlist is configured.
 * Unknown / missing IP is denied when allowlist is non-empty.
 */
export function isAdminIpAllowed(ip: string): boolean {
  const list = getAdminIpAllowlist();
  if (list.length === 0) return true;

  const normalized = ip.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return false;

  // Strip IPv4-mapped IPv6 (:ffff:1.2.3.4)
  const v4 =
    normalized.startsWith("::ffff:")
      ? normalized.slice("::ffff:".length)
      : normalized;

  for (const entry of list) {
    const e = entry.toLowerCase();
    if (e === normalized || e === v4) return true;
    if (e.includes("/") && matchIpv4Cidr(v4, e)) return true;
  }
  return false;
}

export function clientIpFromHeaders(headers: Headers): string {
  return getClientIp(headers, "unknown");
}

export type AdminPasswordHealth = {
  ok: boolean;
  warnings: string[];
};

/**
 * Soft checks for ADMIN_PASSWORD. Does not block startup (ops may use short
 * secrets in local dev) but logs loud warnings in production-ish envs.
 */
export function assessAdminPassword(password: string | undefined): AdminPasswordHealth {
  const warnings: string[] = [];
  if (!password) {
    return { ok: false, warnings: ["ADMIN_PASSWORD is not set — admin is disabled"] };
  }
  if (password.length < 12) {
    warnings.push("ADMIN_PASSWORD is shorter than 12 characters");
  }
  if (password.length < 16 && process.env.NODE_ENV === "production") {
    warnings.push("In production, prefer ADMIN_PASSWORD of 16+ random characters");
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    warnings.push("ADMIN_PASSWORD matches a common weak password");
  }
  if (/^(admin|password|test|deni|flixa)/i.test(password) && password.length < 20) {
    warnings.push("ADMIN_PASSWORD looks predictable (common prefix)");
  }
  return { ok: warnings.length === 0, warnings };
}

export function warnAdminConfigAtStartup(): void {
  const password = Bun.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn(
      "[AdminSecurity] ADMIN_PASSWORD unset — /admin is disabled (503).",
    );
    return;
  }

  const health = assessAdminPassword(password);
  for (const w of health.warnings) {
    console.warn(`[AdminSecurity] ${w}`);
  }

  if (isAdminIpAllowlistEnabled()) {
    console.info(
      `[AdminSecurity] IP allowlist active (${getAdminIpAllowlist().length} entries). ` +
        `Mobile / CGNAT clients will break when their IP changes — only use for fixed networks.`,
    );
  }

  if (
    Bun.env.ADMIN_COOKIE_SECURE !== "true" &&
    process.env.NODE_ENV === "production"
  ) {
    console.warn(
      "[AdminSecurity] Set ADMIN_COOKIE_SECURE=true (or terminate TLS so requests are https) so admin session cookies are Secure.",
    );
  }
}

export type AdminAuditEvent =
  | "login_ok"
  | "login_failed"
  | "logout"
  | "ip_denied"
  | "session_ok"
  | "basic_ok"
  | "unauthorized";

export function logAdminAudit(
  event: AdminAuditEvent,
  details: {
    ip?: string;
    path?: string;
    username?: string;
    reason?: string;
  } = {},
): void {
  const parts = [
    `[AdminAuth] ${event}`,
    details.ip ? `ip=${details.ip}` : null,
    details.path ? `path=${details.path}` : null,
    details.username
      ? `user=${details.username.slice(0, 64)}`
      : null,
    details.reason ? `reason=${details.reason}` : null,
  ].filter(Boolean);
  if (event === "login_failed" || event === "ip_denied") {
    console.warn(parts.join(" "));
  } else {
    console.info(parts.join(" "));
  }
}

/** Small delay after failed login to slow online guessing (ms). */
export async function failedLoginDelay(): Promise<void> {
  const base = 200;
  const jitter = Math.floor(Math.random() * 200);
  await new Promise((r) => setTimeout(r, base + jitter));
}

/**
 * Constant-time-ish credential check: always HMAC both sides so length
 * differences do not short-circuit as obviously.
 */
export async function verifyAdminCredentialsSecure(
  username: string,
  password: string,
  expectedUsername: string,
  expectedPassword: string,
): Promise<boolean> {
  const secret = `flixa-admin-cred-v1:${expectedPassword}`;
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const left = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`${username}\0${password}`),
    ),
  );
  const right = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`${expectedUsername}\0${expectedPassword}`),
    ),
  );

  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left[i]! ^ right[i]!;
  }
  return mismatch === 0;
}
