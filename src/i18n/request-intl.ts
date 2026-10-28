import type { IntlSnapshot } from "@/i18n/extracted";
import { getPreferredLocale } from "@/i18n/locale";
import { loadMessages } from "@/i18n/messages";

/**
 * Locale and messages of the current request for server code outside routes
 * (tRPC procedures, server functions): `getExtracted(await getRequestIntl())`.
 */
export async function getRequestIntl(): Promise<IntlSnapshot> {
  const locale = getPreferredLocale();
  return { locale, messages: await loadMessages(locale) };
}
