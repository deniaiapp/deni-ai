"use client";

import { useLocale, useExtracted } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";

const labels: Record<Locale, string> = { en: "EN", ja: "日本語" };

export function LocaleSwitcher() {
  const t = useExtracted();
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={t("Language")}
      value={current}
      disabled={pending}
      onChange={(event) => {
        const next = event.currentTarget.value;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
      className="fixed right-16 bottom-4 z-50 h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground"
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {labels[locale]}
        </option>
      ))}
    </select>
  );
}
