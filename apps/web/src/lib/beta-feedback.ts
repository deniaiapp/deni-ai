import { supportUrl } from "@/lib/support-url";

/**
 * Link of the account menu's "Send feedback" item: the help center's feedback
 * form (`support.deniai.app/{en,ja}/feedback`). `from=v8` makes the form start
 * with the v8 beta template, which includes `version`.
 */
export function betaFeedbackUrl({ locale, version }: { locale: string; version: string }) {
  const params = new URLSearchParams({ from: "v8", version });
  return `${supportUrl(locale, "/feedback")}?${params.toString()}`;
}
