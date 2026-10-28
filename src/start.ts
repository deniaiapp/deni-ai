import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getPreferredLocaleFromHeader } from "@/i18n/accept-language";
import { LOCALE_COOKIE, toAppLocale } from "@/i18n/locale";
import { defaultLocale } from "@/i18n/locales";
import {
  isAppPath,
  isPublicLocalizablePath,
  JA_PREFIX,
  localizedPath,
  stripJaPrefix,
} from "@/lib/locale-path";
import { signInPath } from "@/lib/sign-in-redirect";
import { compressResponse } from "@/server/compression";

const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;

// Signed-in app routes. Signed-out deep links keep their path + query (device
// codes, team invites) through sign-in; route guards still validate sessions.
const AUTH_REQUIRED_PREFIXES = [
  "/chat",
  "/settings",
  "/projects",
  "/compare",
  "/new",
  "/flixa/authorize",
  "/oauth",
] as const;

function readCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    }
  }
  return cookies;
}

function requiresSession(pathname: string) {
  return AUTH_REQUIRED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Redirects chosen from cookies or Accept-Language. Override the public
 * marketing Cache-Control so a shared cache never replays one visitor's
 * redirect to everyone.
 */
function privateRedirect(location: string, request: Request) {
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(location, request.url).toString(),
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Accept-Language",
    },
  });
}

/** Page requests only: assets, server functions and API routes pass through. */
function isPageRequest(request: Request, pathname: string) {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_serverFn") &&
    !pathname.split("/").at(-1)?.includes(".")
  );
}

/** URL-level routing that runs before route matching (formerly the Next.js proxy). */
export const localeAndAuthRedirects = createMiddleware().server(({ request, next }) => {
  const url = new URL(request.url);
  const { pathname, search } = url;

  // Links joined onto a base URL with a trailing slash arrive as //settings/billing.
  if (pathname.includes("//")) {
    url.pathname = pathname.replace(/\/{2,}/g, "/");
    return Response.redirect(url, 308);
  }

  if (!isPageRequest(request, pathname)) {
    return next();
  }

  // /ja copies of app routes are not localized; send them to the app URL.
  if (pathname.startsWith(`${JA_PREFIX}/`)) {
    const stripped = stripJaPrefix(pathname);
    if (isAppPath(stripped)) {
      return Response.redirect(new URL(`${stripped}${search}`, url), 307);
    }
    return next();
  }

  const cookies = readCookies(request);
  const hasSessionCookie = cookies.has(SESSION_COOKIE) || cookies.has(SECURE_SESSION_COOKIE);
  const cookieLocale = toAppLocale(cookies.get(LOCALE_COOKIE));

  // Root: a cheap session-cookie heuristic. An expired cookie lands on /chat,
  // whose route guard validates the session properly.
  if (pathname === "/") {
    const destination = hasSessionCookie ? "/chat" : cookieLocale === "ja" ? JA_PREFIX : "/home";
    return privateRedirect(destination, request);
  }

  // Unauthenticated page requests never receive the app shell.
  if (requiresSession(pathname) && !hasSessionCookie) {
    return privateRedirect(signInPath(`${pathname}${search}`), request);
  }

  const locale =
    cookieLocale ??
    getPreferredLocaleFromHeader(request.headers.get("accept-language")) ??
    defaultLocale;
  if (locale === "ja" && isPublicLocalizablePath(pathname)) {
    const prefixed = localizedPath(pathname, "ja");
    if (prefixed !== pathname) {
      return privateRedirect(`${prefixed}${search}`, request);
    }
  }

  return next();
});

/**
 * Server functions are same-origin RPC endpoints: reject calls a browser marks
 * as cross-site (Sec-Fetch-Site, then Origin/Referer). Page requests and API
 * routes keep their own checks.
 */
const serverFnCsrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/** Gzips HTML and API responses (Next.js compressed them by default; Nitro does not). */
const compression = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  return { ...result, response: compressResponse(request, result.response) };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [compression, serverFnCsrf, localeAndAuthRedirects],
}));
