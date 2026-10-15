export const locales = ["en", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
/** The locale messages are written in. Its catalog translates every message to itself. */
export const sourceLocale: Locale = "en";
// Kept from the next-intl setup so existing visitors keep their language.
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
