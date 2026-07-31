import type { Context, MiddlewareHandler, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  consumeRateLimit,
  getAdminLoginRateLimitConfig,
  getClientIp,
  getIpRateLimitConfig,
  getUserRateLimitConfig,
  isAgentInferencePath,
  isRateLimitEnabled,
  type RateLimitResult,
} from "../utils/rateLimit";

function applyRateLimitHeaders(c: Context, result: RateLimitResult): void {
  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(result.resetAt));
  if (!result.allowed && result.retryAfterSec > 0) {
    c.header("Retry-After", String(result.retryAfterSec));
  }
}

function rateLimitExceededResponse(
  c: Context,
  result: RateLimitResult,
  message: string,
) {
  applyRateLimitHeaders(c, result);
  return c.json(
    {
      error: {
        message,
        type: "rate_limit_error",
        param: null,
        code: "rate_limit_exceeded",
      },
    },
    429 as ContentfulStatusCode,
  );
}

/**
 * Pre-auth IP rate limit for public API surfaces (`/v1/*`).
 */
export function ipRateLimitMiddleware(
  scope = "ip:v1",
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (!isRateLimitEnabled()) {
      await next();
      return;
    }

    // chat/completions, responses, messages: usage-quota only, no RPS limit
    if (isAgentInferencePath(c.req.path)) {
      await next();
      return;
    }

    const { max, windowMs } = getIpRateLimitConfig();
    const ip = getClientIp(c.req.raw.headers);
    const result = consumeRateLimit(scope, ip, max, windowMs);

    applyRateLimitHeaders(c, result);
    if (!result.allowed) {
      console.warn(
        `[RateLimit] ip blocked ip=${ip} scope=${scope} limit=${result.limit} reset=${result.resetAt}`,
      );
      return rateLimitExceededResponse(
        c,
        result,
        "Too many requests from this IP. Please slow down and try again later.",
      );
    }

    await next();
  };
}

/**
 * Check per-user rate limit after auth. Returns a Response when blocked.
 * Skips agent inference endpoints (chat completions / responses / messages).
 */
export function checkUserRateLimit(
  c: Context,
  userId: string,
): Response | null {
  if (!isRateLimitEnabled()) {
    return null;
  }

  if (isAgentInferencePath(c.req.path)) {
    return null;
  }

  const { max, windowMs } = getUserRateLimitConfig();
  const result = consumeRateLimit("user", userId, max, windowMs);
  applyRateLimitHeaders(c, result);

  if (!result.allowed) {
    console.warn(
      `[RateLimit] user blocked user=${userId} limit=${result.limit} reset=${result.resetAt}`,
    );
    return rateLimitExceededResponse(
      c,
      result,
      "Too many requests for this account. Please slow down and try again later.",
    );
  }

  return null;
}

/**
 * Stricter rate limit for admin login attempts (by IP).
 */
export function adminLoginRateLimitMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (!isRateLimitEnabled() || c.req.method !== "POST") {
      await next();
      return;
    }

    const { max, windowMs } = getAdminLoginRateLimitConfig();
    const ip = getClientIp(c.req.raw.headers);
    const result = consumeRateLimit("admin-login", ip, max, windowMs);

    if (!result.allowed) {
      console.warn(
        `[RateLimit] admin login blocked ip=${ip} limit=${result.limit} reset=${result.resetAt}`,
      );
      applyRateLimitHeaders(c, result);
      // Prefer HTML-friendly response for form posts.
      const accept = (c.req.header("Accept") || "").toLowerCase();
      const contentType = (c.req.header("content-type") || "").toLowerCase();
      if (
        accept.includes("text/html") ||
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        return c.text(
          `Too many login attempts. Try again in ${result.retryAfterSec}s.`,
          429,
        );
      }
      return rateLimitExceededResponse(
        c,
        result,
        `Too many login attempts. Try again in ${result.retryAfterSec}s.`,
      );
    }

    await next();
  };
}
