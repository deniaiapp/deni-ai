import { type AppLocale, locales } from "@/i18n/locales";

/**
 * Pick the highest-ranked supported locale from an Accept-Language header.
 * Shared by the proxy and next-intl so both negotiate the same way: entries are
 * ordered by q-value (then position), and `q=0` means "not acceptable".
 */
export function getPreferredLocaleFromHeader(acceptLanguage: string | null): AppLocale | null {
  if (!acceptLanguage) {
    return null;
  }

  const candidates = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [rawTag, ...params] = entry.trim().split(";");
      if (!rawTag) {
        return null;
      }

      let quality = 1;
      for (const param of params) {
        const [key, value] = param.trim().split("=");
        if (key?.trim().toLowerCase() === "q") {
          quality = Number.parseFloat(value ?? "");
        }
      }

      return {
        tag: rawTag.trim().toLowerCase(),
        quality,
        index,
      };
    })
    .filter(
      (candidate): candidate is { tag: string; quality: number; index: number } =>
        candidate !== null &&
        candidate.tag !== "*" &&
        Number.isFinite(candidate.quality) &&
        candidate.quality > 0,
    )
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    const matched = locales.find(
      (locale) => candidate.tag === locale || candidate.tag.startsWith(`${locale}-`),
    );
    if (matched) {
      return matched;
    }
  }

  return null;
}
