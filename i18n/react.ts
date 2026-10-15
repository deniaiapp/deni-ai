import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { createExtractedTranslator, type ExtractedTranslator } from "./translator";

export { useLocale };

/** Translator for components: `t("Message in English", values)`. */
export function useExtracted(): ExtractedTranslator {
  const t = useTranslations();
  const locale = useLocale();
  return useMemo(() => createExtractedTranslator(t, locale), [t, locale]);
}
