import { isLanguage, type Language } from '@/lib/i18n';
import type { SupportErrorBody, SupportErrorCode } from '@/lib/support-protocol';

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

/** Parses a JSON object body, rejecting cross-site posts and oversized bodies. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return undefined;

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
