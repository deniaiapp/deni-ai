import type { AbstractIntlMessages } from "use-intl";
import { sourceLocale, type Locale, type TranslatedLocale } from "./config";

// Each catalog is its own chunk; vite-plugins/i18n.ts compiles the .po file to { id: message }.
// The source locale has no catalog, so i18n/translator.ts formats every message from its source.
const catalogs: Record<TranslatedLocale, () => Promise<{ default: AbstractIntlMessages }>> = {
  ja: () => import("../messages/ja.po"),
};

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  if (locale === sourceLocale) return {};
  return (await catalogs[locale]()).default;
}
