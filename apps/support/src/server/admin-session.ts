// Admin inbox sign-in: one shared password (SUPPORT_ADMIN_TOKEN) exchanged for a
// signed, expiring, HttpOnly cookie. Read only inside server function handlers.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server';
import { isConversationStoreEnabled } from './conversations';
import { serverEnv } from './env';

const cookieName = '__Host-support-admin';
const ttlMs = 12 * 60 * 60_000;
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/** The inbox needs saved conversations and an admin password. */
export function isAdminEnabled(): boolean {
  return isConversationStoreEnabled() && Boolean(serverEnv.adminToken);
}

function sign(expiresAt: number): string {
  // Changing the password signs every session out.
  return createHmac('sha256', `support-admin:${serverEnv.supportSecret}:${serverEnv.adminToken}`)
    .update(String(expiresAt))
    .digest('base64url');
}

function sameSecret(a: string, b: string): boolean {
  // Hashing first makes the comparison constant-time whatever the lengths.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function isAdminPassword(value: unknown): boolean {
  const token = serverEnv.adminToken;
  return Boolean(isAdminEnabled() && token && typeof value === 'string' && sameSecret(value, token));
}

export function startAdminSession() {
  const expiresAt = Date.now() + ttlMs;
  setCookie(cookieName, `${expiresAt}.${sign(expiresAt)}`, {
    ...cookieOptions,
    maxAge: ttlMs / 1000,
  });
}

export function endAdminSession() {
  deleteCookie(cookieName, cookieOptions);
}

export function hasAdminSession(): boolean {
  if (!isAdminEnabled()) return false;
  const value = getCookie(cookieName);
  if (!value || value.length > 200) return false;
  const [expires, signature] = value.split('.');
  const expiresAt = Number(expires);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  return sameSecret(signature, sign(expiresAt));
}

/** Throws unless the request carries a valid admin session. */
export function requireAdmin() {
  if (!hasAdminSession()) throw new Error('Unauthorized');
}
