import type { _useExtracted } from "use-intl";

declare module "use-intl" {
  /**
   * use-intl ships this hook as `_useExtracted`; the extract-messages Vite
   * plugin compiles every `useExtracted()` call to `useTranslations()` with
   * catalog keys, so the runtime export is never reached.
   */
  export const useExtracted: typeof _useExtracted;
}
