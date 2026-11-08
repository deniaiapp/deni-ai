import type { AppLocale } from "@/i18n/locales";
import { absoluteUrl, hreflangLanguages } from "@/lib/locale-path";
import { PUBLIC_SITE_ORIGIN } from "@/lib/public-pages";

/** Shared homepage SERP copy. Keep title ~50–60 chars and description ~150–160. */
export const HOME_TITLE = "Deni AI (Deni Chat) — Free GPT, Claude & Gemini";

export const HOME_DESCRIPTION =
  "Open Deni Chat in your browser — free AI chat with GPT, Claude, Gemini and more. Official Deni AI site. Web on mobile, desktop for Windows and macOS.";

export const HOME_TITLE_JA = "Deni AI — 無料AIチャット（GPT・Claude・Gemini）";

export const HOME_DESCRIPTION_JA =
  "ブラウザで使える無料のAIチャット。GPT、Claude、Gemini、Grokを一つの画面で切り替え。Deni Chat（Deni AI）公式。スマホはWeb、デスクトップはWindows / macOS。";

export const HOME_ALTERNATE_NAMES = ["Deni Chat", "denichat", "deniai.app"] as const;

const TITLE_SUFFIX = " | Deni AI";

type HeadMeta = React.JSX.IntrinsicElements["meta"];
type HeadLink = React.JSX.IntrinsicElements["link"];
type HeadScript = React.JSX.IntrinsicElements["script"];

/** JSON-LD body that cannot close its <script> element. */
export function safeJsonLd(data: unknown) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export type PageSeo = {
  /** Rendered as `<title> | Deni AI` unless `absoluteTitle` is set. */
  title?: string;
  absoluteTitle?: boolean;
  description?: string;
  /**
   * Public (unprefixed) path of a localizable page. Adds the canonical URL for
   * `locale` plus en/ja/x-default alternates.
   */
  alternates?: { path: string; locale: AppLocale };
  canonical?: string;
  openGraph?: {
    title?: string;
    description?: string;
    type?: string;
    locale?: string;
    url?: string;
    images?: string[];
    publishedTime?: string;
  };
  twitter?: { title?: string; description?: string; card?: string };
  robots?: { index: boolean; follow: boolean };
  jsonLd?: unknown;
};

function absoluteAssetUrl(url: string) {
  return url.startsWith("http") ? url : `${PUBLIC_SITE_ORIGIN}${url}`;
}

/**
 * Route `head()` tags for a page. Child routes override root tags with the same
 * `name`/`property`, so pass only what the page changes.
 */
export function pageHead(seo: PageSeo): {
  meta: HeadMeta[];
  links: HeadLink[];
  scripts: HeadScript[];
} {
  const meta: HeadMeta[] = [];
  const links: HeadLink[] = [];
  const scripts: HeadScript[] = [];

  if (seo.title) {
    meta.push({ title: seo.absoluteTitle ? seo.title : `${seo.title}${TITLE_SUFFIX}` });
  }
  if (seo.description) {
    meta.push({ name: "description", content: seo.description });
  }

  const og = seo.openGraph;
  if (og?.title) meta.push({ property: "og:title", content: og.title });
  if (og?.description) meta.push({ property: "og:description", content: og.description });
  if (og?.type) meta.push({ property: "og:type", content: og.type });
  if (og?.locale) meta.push({ property: "og:locale", content: og.locale });
  if (og?.url) meta.push({ property: "og:url", content: absoluteAssetUrl(og.url) });
  if (og?.publishedTime) {
    meta.push({ property: "article:published_time", content: og.publishedTime });
  }
  for (const image of og?.images ?? []) {
    meta.push({ property: "og:image", content: absoluteAssetUrl(image) });
  }

  const twitter = seo.twitter;
  if (twitter?.card) meta.push({ name: "twitter:card", content: twitter.card });
  if (twitter?.title) meta.push({ name: "twitter:title", content: twitter.title });
  if (twitter?.description) {
    meta.push({ name: "twitter:description", content: twitter.description });
  }

  if (seo.robots) {
    meta.push({
      name: "robots",
      content: `${seo.robots.index ? "index" : "noindex"}, ${seo.robots.follow ? "follow" : "nofollow"}`,
    });
  }

  if (seo.alternates) {
    const { path, locale } = seo.alternates;
    links.push({ rel: "canonical", href: absoluteUrl(path, locale) });
    for (const [hrefLang, href] of Object.entries(hreflangLanguages(path))) {
      links.push({ rel: "alternate", hrefLang, href });
    }
  } else if (seo.canonical) {
    links.push({ rel: "canonical", href: absoluteAssetUrl(seo.canonical) });
  }

  if (seo.jsonLd !== undefined) {
    scripts.push({ type: "application/ld+json", children: safeJsonLd(seo.jsonLd) });
  }

  return { meta, links, scripts };
}
