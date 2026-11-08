import type { AppLocale } from "@/i18n/locales";
import {
  HOME_DESCRIPTION,
  HOME_DESCRIPTION_JA,
  HOME_TITLE,
  HOME_TITLE_JA,
  pageHead,
} from "@/lib/seo";

// Kept apart from the page component: route `head` is not code-split, so
// whatever it imports loads on every page.
/** Head tags shared by `/home` and `/ja`. */
export function homeHead(locale: AppLocale) {
  const title = locale === "ja" ? HOME_TITLE_JA : HOME_TITLE;
  const description = locale === "ja" ? HOME_DESCRIPTION_JA : HOME_DESCRIPTION;

  return pageHead({
    title,
    absoluteTitle: true,
    description,
    alternates: { path: "/home", locale },
    openGraph: {
      title,
      description,
      locale: locale === "ja" ? "ja_JP" : "en_US",
    },
    twitter: {
      title,
      description,
    },
  });
}
