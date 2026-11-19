import { supportUrl } from "@/lib/support-url";

/**
 * Link of the account menu's "Send feedback" item, shown in the private beta and
 * while deniai.app is split between v7 and v8 (`ROLLOUT_SWITCH_ENABLED`): the help
 * center's feedback form (`support.deniai.app/{en,ja}/feedback`). `from=v8` makes
 * the form start with the v8 template, which includes `version`, so v8 feedback
 * can be told apart from v7's.
 */
export function betaFeedbackUrl({ locale, version }: { locale: string; version: string }) {
  const params = new URLSearchParams({ from: "v8", version });
  return `${supportUrl(locale, "/feedback")}?${params.toString()}`;
}
