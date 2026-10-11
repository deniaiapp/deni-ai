import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getPreferredLocaleFromHeader } from "@/i18n/accept-language";
import { defaultLocale, locales } from "@/i18n/locales";

export default getRequestConfig(async () => {
  const store = await cookies();
  const requestHeaders = await headers();
  const forcedLocale = locales.find((locale) => locale === requestHeaders.get("x-locale"));
  const persistedLocale = store.get("locale")?.value;
  const storedLocale = locales.find((locale) => locale === persistedLocale);
  const headerLocale = getPreferredLocaleFromHeader(requestHeaders.get("accept-language"));
  const locale = forcedLocale ?? storedLocale ?? headerLocale ?? defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
