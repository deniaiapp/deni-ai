import { createServerFn } from "@tanstack/react-start";

export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEME_COOKIE = "theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

/** The theme saved in the cookie, or null when the visitor never chose one. */
export const getThemePreference = createServerFn({ method: "GET" }).handler(async () => {
  const { getCookie } = await import("@tanstack/react-start/server");
  const value = getCookie(THEME_COOKIE);
  return isTheme(value) ? value : null;
});
