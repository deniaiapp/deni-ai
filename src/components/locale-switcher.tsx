import { useRouter } from "@tanstack/react-router";
import { useLocale } from "use-intl";
import { usePathname } from "@/lib/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeLocale } from "@/i18n/locale-functions";
import { type AppLocale, locales } from "@/i18n/locales";
import { localizedPath } from "@/lib/locale-path";

const localeLabels: Record<AppLocale, string> = {
  en: "English",
  ja: "日本語",
};

export function LocaleSwitcher() {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Select
      value={locale}
      onValueChange={async (value) => {
        const nextLocale = value as AppLocale;
        await changeLocale({ data: { locale: nextLocale } });
        await router.navigate({ href: localizedPath(pathname, nextLocale) });
        // App routes keep their URL; reload route data so the new cookie applies.
        await router.invalidate();
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue>{localeLabels[locale] ?? locale}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {locales.map((option) => (
          <SelectItem key={option} value={option}>
            {localeLabels[option] ?? option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
