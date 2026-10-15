import "@tanstack/react-start/server-only";

import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { loadMessages } from "./messages";
import { translatorFor, type ExtractedTranslator } from "./translator";

// Server counterpart of i18n/react.ts for route handlers, server functions, and lib code that runs
// during a request. The request utilities are imported lazily so lib modules still load in the
// standalone worker and the verify scripts, which have no request.

export function localeFromRequest(cookieLocale: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}

export async function getLocale(): Promise<Locale> {
  const { getCookie, getRequestHeader } = await import("@tanstack/react-start/server");
  return localeFromRequest(getCookie(LOCALE_COOKIE), getRequestHeader("accept-language") ?? null);
}

/** Translator for the current request's locale, or for `options.locale` when given. */
export async function getExtracted(options?: { locale?: Locale }): Promise<ExtractedTranslator> {
  const locale = options?.locale ?? (await getLocale());
  return translatorFor(locale, await loadMessages(locale));
}
