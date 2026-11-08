const SUPPORT_ORIGIN = "https://support.deniai.app";

/** Help center (support.deniai.app) URL in the visitor's language, e.g. `/flixa/external-tools`. */
export function supportUrl(locale: string, path = ""): string {
  return `${SUPPORT_ORIGIN}/${locale === "ja" ? "ja" : "en"}${path}`;
}
