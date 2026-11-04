// A chat session pass: after one Turnstile check, the widget sends this signed,
// expiring value instead of solving a new challenge for every message.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from './env';

const ttlMs = 30 * 60_000;

function sign(expiresAt: number): string {
  return createHmac('sha256', `support-session:${serverEnv.turnstileSecretKey}`)
    .update(String(expiresAt))
    .digest('base64url');
}

/** A pass valid for the next 30 minutes. */
export function issueSupportSession(): string {
  const expiresAt = Date.now() + ttlMs;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifySupportSession(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 100) return false;

  const [expires, signature] = value.split('.');
  const expiresAt = Number(expires);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = Buffer.from(sign(expiresAt));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
