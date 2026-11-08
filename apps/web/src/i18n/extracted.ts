import { type _useExtracted, type AbstractIntlMessages, createTranslator } from "use-intl";
import type { AppLocale } from "@/i18n/locales";

export type IntlSnapshot = {
  locale: AppLocale;
  messages: AbstractIntlMessages;
};

type ExtractedTranslator = ReturnType<typeof _useExtracted>;

/**
 * Inline-message translator for code outside React components (route `head`,
 * loaders, server handlers). Assign it before use:
 *
 *   const t = getExtracted(intl);
 *   t("Sign in required");
 *
 * The extract-messages Vite plugin compiles this call to `getTranslations()`
 * with catalog keys, exactly like `useExtracted()` inside components.
 */
export function getExtracted(_intl: IntlSnapshot): ExtractedTranslator {
  throw new Error("getExtracted() must be compiled by the extract-messages Vite plugin.");
}

/** Compilation target of `getExtracted()`; not meant to be called directly. */
export function getTranslations({ locale, messages }: IntlSnapshot) {
  return createTranslator({ locale, messages });
}
