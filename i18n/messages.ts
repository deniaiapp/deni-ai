import type { AbstractIntlMessages } from "use-intl";
import type { Locale } from "./config";

// Each catalog is its own chunk; vite-plugins/i18n.ts compiles the .po file to { id: message }.
const catalogs: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import("../messages/en.po"),
  ja: () => import("../messages/ja.po"),
};

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  return (await catalogs[locale]()).default;
}
