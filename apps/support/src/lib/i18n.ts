import { defaultLocale, locales } from '@deniai/i18n/locales';
import { defineI18n } from 'fumadocs-core/i18n';

// Same locales as the web app (@deniai/i18n/locales).
export const i18n = defineI18n({
  defaultLanguage: defaultLocale,
  languages: [...locales],
});

export type Language = (typeof i18n.languages)[number];

export function isLanguage(value: string | undefined): value is Language {
  return value !== undefined && (i18n.languages as readonly string[]).includes(value);
}

/** Falls back to the default language when `value` is not a supported language. */
export function resolveLanguage(value: string | undefined): Language {
  return isLanguage(value) ? value : i18n.defaultLanguage;
}

/** Picks the best supported language from an `Accept-Language` header or `navigator.languages`. */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.split(';')[0].trim().split('-')[0].toLowerCase();
    if (isLanguage(base)) return base;
  }
  return i18n.defaultLanguage;
}
