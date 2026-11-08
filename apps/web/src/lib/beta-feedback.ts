import { SUPPORT_EMAIL } from "@/lib/constants";

/**
 * `mailto:` link of the account menu's "Send feedback" item: the support
 * address with a v8 beta subject and the app version, so feedback is easy to
 * tell apart in the inbox.
 */
export function betaFeedbackMailto({ subject, version }: { subject: string; version: string }) {
  const params = new URLSearchParams({
    subject,
    body: `\n\n—\nDeni AI ${version}`,
  });
  // mailto bodies expect %20, not the + URLSearchParams writes for spaces.
  return `mailto:${SUPPORT_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}
