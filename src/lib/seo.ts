import type { Metadata } from "next";
import { headers } from "next/headers";
import { absoluteUrl, hreflangLanguages, URL_LOCALE_HEADER } from "@/lib/locale-path";

/** Shared homepage SERP copy. Keep title ~50–60 chars and description ~150–160. */
export const HOME_TITLE = "Deni AI (Deni Chat) — Free GPT, Claude & Gemini";

export const HOME_DESCRIPTION =
  "Open Deni Chat in your browser — free AI chat with GPT, Claude, Gemini and more. Official Deni AI site. Web on mobile, desktop for Windows and macOS.";

export const HOME_TITLE_JA = "Deni AI — 無料AIチャット（GPT・Claude・Gemini）";

export const HOME_DESCRIPTION_JA =
  "ブラウザで使える無料のAIチャット。GPT、Claude、Gemini、Grokを一つの画面で切り替え。Deni Chat（Deni AI）公式。スマホはWeb、デスクトップはWindows / macOS。";

export const HOME_ALTERNATE_NAMES = ["Deni Chat", "denichat", "deniai.app"] as const;

export async function publicAlternates(path: string): Promise<Metadata["alternates"]> {
  const urlLocale = (await headers()).get(URL_LOCALE_HEADER) === "ja" ? "ja" : "en";
  return {
    canonical: absoluteUrl(path, urlLocale),
    languages: hreflangLanguages(path),
  };
}
