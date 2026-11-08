export const locales = ["en", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
/** The locale messages are written in. It has no catalog: messages are shown as written. */
export const sourceLocale = "en" satisfies Locale;
/** Locales with a catalog in messages/. */
export type TranslatedLocale = Exclude<Locale, typeof sourceLocale>;
export const translatedLocales = locales.filter((locale): locale is TranslatedLocale => locale !== sourceLocale);
// Kept from the next-intl setup so existing visitors keep their language.
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
