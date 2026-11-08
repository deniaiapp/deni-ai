import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { LOCALE_COOKIE } from "@/i18n/locale";
import { locales } from "@/i18n/locales";

/** Persists the UI locale. Guests may change it too; the cookie alone drives the UI. */
export const changeLocale = createServerFn({ method: "POST" })
  .validator(z.object({ locale: z.enum(locales) }))
  .handler(({ data }) => {
    setCookie(LOCALE_COOKIE, data.locale, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  });
