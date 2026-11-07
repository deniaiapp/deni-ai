import { createServerFn } from "@tanstack/react-start";
import { isLocale, LOCALE_COOKIE } from "./config";

/**
 * The visitor's locale, and the server's time zone, which use-intl needs to format dates the same
 * way during SSR and hydration (next-intl used the server's zone by default too).
 */
export const getRequestIntl = createServerFn({ method: "GET" }).handler(async () => {
  const { getLocale } = await import("./server");
  return { locale: await getLocale(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
});

export const setLocale = createServerFn({ method: "POST" })
  .validator((locale: unknown) => (typeof locale === "string" && isLocale(locale) ? locale : null))
  .handler(async ({ data: locale }) => {
    if (!locale) return;
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  });
