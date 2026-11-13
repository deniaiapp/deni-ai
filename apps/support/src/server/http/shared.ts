import { isLanguage, type Language } from '@/lib/i18n';
import {
  supportLimits,
  type ChatTurn,
  type SupportErrorBody,
  type SupportErrorCode,
} from '@/lib/support-protocol';
import { verifySupportSession } from '../support-session';
import { isTurnstileEnabled, verifyTurnstile } from '../turnstile';

const statusByError: Record<SupportErrorCode, number> = {
  invalid: 400,
  verification_failed: 403,
  rate_limited: 429,
  refused: 422,
  unavailable: 503,
  failed: 500,
};

export function errorResponse(error: SupportErrorCode, retryAfter?: number): Response {
  const body: SupportErrorBody = retryAfter ? { error, retryAfter } : { error };
  return Response.json(body, {
    status: statusByError[error],
    headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined,
  });
}

/**
 * True unless the browser says the request came from another site. Only hosts are
 * compared: TLS ends at the proxy, so the server sees its own URL as `http:` while
 * browsers send an `https:` origin.
 */
function isSameSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(request.url).host || host === request.headers.get('x-forwarded-host');
  } catch {
    return false;
  }
}

/** Parses a JSON object body, rejecting cross-site posts and oversized bodies. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  if (!isSameSite(request)) return undefined;

  const text = await request.text();
  if (text.length > maxBytes) return undefined;

  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed || undefined;
}

export function requiredString(value: unknown, maxLength: number): string | null {
  const result = optionalString(value, maxLength);
  return result ?? null;
}

export function readLanguage(value: unknown): Language | null {
  return typeof value === 'string' && isLanguage(value) ? value : null;
}

/** A same-site path such as `/en/billing/payments`. */
export function readPagePath(value: unknown): string | undefined | null {
  const path = optionalString(value, 300);
  if (path === undefined || path === null) return path;
  return path.startsWith('/') && !path.startsWith('//') ? path : null;
}

const emailPattern = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function isEmail(value: string): boolean {
  return emailPattern.test(value);
}

/**
 * Checks a form submission's Turnstile token. From the support widget, the chat
 * session pass stands in for a fresh token.
 */
export async function verifyHuman(body: Record<string, unknown>, ip: string): Promise<boolean> {
  if (isTurnstileEnabled() && verifySupportSession(body.session)) return true;
  return verifyTurnstile(body.turnstileToken, ip);
}

/** The optional AI chat conversation sent from the widget, within the chat limits. */
export function readTranscript(value: unknown): ChatTurn[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > supportLimits.chatMessages) return null;

  let total = 0;
  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const text = content.trim();
    if (text.length > supportLimits.chatMessageLength) return null;
    if (!text) continue;
    total += text.length;
    turns.push({ role, content: text });
  }

  if (total > supportLimits.chatTotalLength) return null;
  return turns.length > 0 ? turns : undefined;
}

export function formatTranscript(turns: ChatTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}:\n${turn.content}`)
    .join('\n\n');
}
