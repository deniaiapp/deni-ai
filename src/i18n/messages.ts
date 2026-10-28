import type { AbstractIntlMessages } from "use-intl";
import type { AppLocale } from "@/i18n/locales";

const catalogs = import.meta.glob<{ default: Record<string, string> }>("../../messages/*.json");

const cache = new Map<AppLocale, AbstractIntlMessages>();

/**
 * Untranslated entries are written as "" by the message extractor; dropping
 * them lets use-intl fall back to the inline source message.
 */
function withoutEmptyMessages(catalog: Record<string, string>): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(catalog).filter(([, message]) => message !== ""));
}

export async function loadMessages(locale: AppLocale): Promise<AbstractIntlMessages> {
  const cached = cache.get(locale);
  if (cached) {
    return cached;
  }
  const load = catalogs[`../../messages/${locale}.json`];
  if (!load) {
    throw new Error(`Missing message catalog for locale "${locale}"`);
  }
  const messages = withoutEmptyMessages((await load()).default);
  cache.set(locale, messages);
  return messages;
}

/** Reuse the catalog that came with the server render instead of fetching it again. */
export function primeMessages(locale: AppLocale, messages: AbstractIntlMessages) {
  if (!cache.has(locale)) {
    cache.set(locale, messages);
  }
}
