/**
 * Locales used by this app. Mapped over `date-fns/locale` in tsconfig paths
 * so tsc does not load every date-fns locale.
 */
export { enUS } from "date-fns/locale/en-US";
export { ja } from "date-fns/locale/ja";
export type Locale = typeof import("date-fns/locale/en-US").enUS;
