/**
 * Stand-in for `use-intl` in component tests: `vi.mock("use-intl", () => import("@/test/intl-mock"))`.
 *
 * The extract-messages plugin compiles `useExtracted()` to `useTranslations()`
 * and passes the English source message as the fallback argument, so this
 * renders English copy with `{placeholders}` filled in.
 */
function format(message: string, values?: Record<string, unknown>) {
  return message.replace(/\{(\w+)\}/g, (_match, key: string) => String(values?.[key] ?? ""));
}

export function useTranslations() {
  const t = (_key: string, values?: Record<string, unknown>, _formats?: unknown, message = "") =>
    format(message, values);
  return Object.assign(t, { rich: t, markup: t, has: () => true });
}

export function useLocale() {
  return "en";
}
