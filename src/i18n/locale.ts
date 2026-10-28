import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { getPreferredLocaleFromHeader } from "@/i18n/accept-language";
import { type AppLocale, defaultLocale, locales } from "@/i18n/locales";
import { JA_PREFIX } from "@/lib/locale-path";

export const LOCALE_COOKIE = "locale";

export function toAppLocale(value: string | null | undefined): AppLocale | null {
  return locales.find((locale) => locale === value) ?? null;
}

/** `/ja` and `/ja/*` URLs always render Japanese. */
export function localeFromPathname(pathname: string): AppLocale | null {
  return pathname === JA_PREFIX || pathname.startsWith(`${JA_PREFIX}/`) ? "ja" : null;
}

function readCookie(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * The visitor's chosen locale: the `locale` cookie, then Accept-Language (the
 * browser's language list on the client), then English.
 */
export const getPreferredLocale = createIsomorphicFn()
  .server(
    (): AppLocale =>
      toAppLocale(getCookie(LOCALE_COOKIE)) ??
      getPreferredLocaleFromHeader(getRequestHeader("accept-language") ?? null) ??
      defaultLocale,
  )
  .client(
    (): AppLocale =>
      toAppLocale(readCookie(document.cookie, LOCALE_COOKIE)) ??
      getPreferredLocaleFromHeader(navigator.languages.join(",")) ??
      defaultLocale,
  );
