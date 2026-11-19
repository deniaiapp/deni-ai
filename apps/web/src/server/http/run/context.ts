import { auth } from "@/lib/auth";
import { getPreferredLocale } from "@/i18n/locale";
import { guardMutationRequest } from "@/lib/mutation-request";
import { checkRateLimit } from "@/lib/rate-limit";
import { ensureRunConfigured } from "@/lib/run/runtime.server";

/**
 * Shared plumbing of the Run API (`/api/run/*`): the signed-in, non-guest user, the
 * request locale, the configured `@deniai/run` runtime, and JSON error responses.
 * Errors carry a stable `error` code the Run UI translates; `message` is detail.
 */

export type RunRequestContext = {
  request: Request;
  url: URL;
  userId: string;
  locale: "en" | "ja";
};

export function runError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export function runJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Authenticate a Run API request. Guests cannot use Run (it spends the account's
 * shared pool and keeps data per account). Mutations must come from this site.
 */
export async function authenticateRun(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<RunRequestContext | Response> {
  if (options.mutation) {
    const rejected = guardMutationRequest(request);
    if (rejected) return rejected;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.session?.userId;
  if (!userId) return runError(401, "unauthorized");
  if (session?.user?.isAnonymous) return runError(403, "guest_account");
  const setup = ensureRunConfigured();
  if (!setup.ok) return runError(503, "run_unconfigured");
  const preferred = getPreferredLocale();
  return {
    request,
    url: new URL(request.url),
    userId,
    locale: preferred === "ja" ? "ja" : "en",
  };
}

/** Per-user fixed-window limit; a Response when exceeded. */
export async function limitRun(userId: string, name: string, maxPerMinute: number) {
  const result = await checkRateLimit({
    key: `run:${name}:${userId}`,
    windowMs: 60_000,
    maxRequests: maxPerMinute,
  });
  if (result.allowed) return null;
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}
