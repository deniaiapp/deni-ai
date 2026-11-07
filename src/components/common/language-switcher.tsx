import { useExtracted, useLocale } from "@/i18n/react";
import { useRouter } from "@tanstack/react-router";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/i18n/functions";
import { locales, type Locale } from "@/i18n/config";

export const localeLabels: Record<Locale, string> = { en: "English", ja: "日本語" };

// For signed-out pages, which have no account menu. The choice is saved in the locale cookie,
// so it carries over after sign-in.
export function LanguageSwitcher() {
  const t = useExtracted();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("Language")}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <Globe className="size-4" />
        <span className="hidden sm:inline">{localeLabels[locale] ?? locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) => {
            if (next === locale) return;
            startTransition(async () => {
              await setLocale({ data: next });
              await router.invalidate();
            });
          }}
        >
          {locales.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {localeLabels[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
