import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

/**
 * Which UI generation a browser sees: `next` (the Aizome design system, the
 * default) or `legacy` (the previous neutral tokens and theme presets). The root
 * route renders it as `<html data-ui>`; `src/styles/globals.css` scopes tokens
 * to it. See docs/design-system.md, "UI preference".
 */
export const UI_PREFERENCES = ["next", "legacy"] as const;
export type UiPreference = (typeof UI_PREFERENCES)[number];

export const UI_PREFERENCE_COOKIE = "deni-ui";
export const DEFAULT_UI_PREFERENCE: UiPreference = "next";
const UI_PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseUiPreference(value: string | null | undefined): UiPreference {
  return UI_PREFERENCES.find((preference) => preference === value) ?? DEFAULT_UI_PREFERENCE;
}

/** Reads one cookie from a `Cookie` header or `document.cookie` string. */
export function readCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** `document.cookie` assignment that stores the preference for a year. */
export function serializeUiPreferenceCookie(
  preference: UiPreference,
  { secure = false }: { secure?: boolean } = {},
): string {
  return [
    `${UI_PREFERENCE_COOKIE}=${preference}`,
    "Path=/",
    `Max-Age=${UI_PREFERENCE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** The current browser's preference, on the server (request cookie) and the client. */
export const getUiPreference = createIsomorphicFn()
  .server((): UiPreference => parseUiPreference(getCookie(UI_PREFERENCE_COOKIE)))
  .client((): UiPreference =>
    parseUiPreference(readCookieValue(document.cookie, UI_PREFERENCE_COOKIE)),
  );

/**
 * Stores the preference and applies it to the open page at once; the caller
 * re-runs the root route (`router.invalidate()`) so React renders the same value.
 */
export function storeUiPreference(preference: UiPreference) {
  document.cookie = serializeUiPreferenceCookie(preference, {
    secure: window.location.protocol === "https:",
  });
  document.documentElement.dataset.ui = preference;
}
