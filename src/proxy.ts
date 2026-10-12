import { type NextRequest, NextResponse } from "next/server";
import { getPreferredLocaleFromHeader } from "@/i18n/accept-language";
import { defaultLocale } from "@/i18n/locales";
import {
  isAppPath,
  isPublicLocalizablePath,
  JA_PREFIX,
  localizedPath,
  stripJaPrefix,
  URL_LOCALE_HEADER,
} from "@/lib/locale-path";
import { RETURN_TO_HEADER, signInPath } from "@/lib/sign-in-redirect";

const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;
const LOCALE_COOKIE = "locale";
const LOCALE_HEADER = "x-locale";

// Signed-in app routes. Chat is hosted outside layout RequireAuth (SPA
// ChatRouteHost); the rest are gated here so signed-out deep links keep their
// path + query (device codes, team invites) through sign-in.
const AUTH_REQUIRED_PREFIXES = [
  "/chat",
  "/settings",
  "/projects",
  "/compare",
  "/new",
  "/flixa/authorize",
] as const;

function hasSessionCookie(request: NextRequest) {
  return request.cookies.has(SESSION_COOKIE) || request.cookies.has(SECURE_SESSION_COOKIE);
}

function requiresSession(pathname: string) {
  return AUTH_REQUIRED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function localeFromRequest(request: NextRequest): "en" | "ja" {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale === "en" || cookieLocale === "ja") {
    return cookieLocale;
  }
  return getPreferredLocaleFromHeader(request.headers.get("accept-language")) ?? defaultLocale;
}

function withLocaleRequestHeaders(request: NextRequest, locale: "en" | "ja", urlLocale?: "ja") {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  // Internal headers the app trusts: only the proxy may set them.
  requestHeaders.delete(URL_LOCALE_HEADER);
  if (urlLocale) {
    requestHeaders.set(URL_LOCALE_HEADER, urlLocale);
  }
  requestHeaders.set(RETURN_TO_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return requestHeaders;
}

/**
 * Redirects chosen from cookies or Accept-Language. Override the public
 * marketing Cache-Control from next.config so a shared cache never replays one
 * visitor's redirect to everyone.
 */
function privateRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie, Accept-Language");
  return response;
}

function applyLocaleHeader(response: NextResponse, locale: "en" | "ja") {
  response.headers.set(LOCALE_HEADER, locale);
  return response;
}

function rewriteLocalized(request: NextRequest, pathname: string, locale: "ja") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return applyLocaleHeader(
    NextResponse.rewrite(url, {
      request: { headers: withLocaleRequestHeaders(request, locale, "ja") },
    }),
    locale,
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === JA_PREFIX || pathname === `${JA_PREFIX}/`) {
    return rewriteLocalized(request, "/home", "ja");
  }

  if (pathname.startsWith(`${JA_PREFIX}/`)) {
    const stripped = stripJaPrefix(pathname);
    if (isAppPath(stripped)) {
      return NextResponse.redirect(new URL(`${stripped}${search}`, request.url));
    }
    return rewriteLocalized(request, stripped, "ja");
  }

  // Root path: redirect based on session cookie presence.
  // This is a lightweight heuristic — it checks cookie presence, not validity.
  // An expired or invalid cookie will redirect to /chat, where full server-side
  // auth validation occurs and handles the session properly.
  if (pathname === "/") {
    const destination = hasSessionCookie(request)
      ? "/chat"
      : request.cookies.get(LOCALE_COOKIE)?.value === "ja"
        ? JA_PREFIX
        : "/home";
    return privateRedirect(new URL(destination, request.url));
  }

  // Unauthenticated document/RSC requests never receive the app shell. Layout
  // guards still handle expired cookies via RETURN_TO_HEADER.
  if (requiresSession(pathname) && !hasSessionCookie(request)) {
    return privateRedirect(new URL(signInPath(`${pathname}${search}`), request.url));
  }

  const locale = localeFromRequest(request);

  if (locale === "ja" && isPublicLocalizablePath(pathname)) {
    const prefixed = localizedPath(pathname, "ja");
    if (prefixed !== pathname) {
      return privateRedirect(new URL(`${prefixed}${search}`, request.url));
    }
  }

  const response = NextResponse.next({
    request: { headers: withLocaleRequestHeaders(request, locale) },
  });
  return applyLocaleHeader(response, locale);
}

export const config = {
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
