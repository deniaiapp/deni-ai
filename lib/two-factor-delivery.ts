import "server-only";

import { getExtracted, getLocale } from "next-intl/server";
import { loadEmailRenderer } from "./emails";

// Email codes and passkeys are the alternatives to an authenticator app. Email is offered only
// while Resend is configured, so a deployment without it keeps passkeys and the app.

export type TwoFactorMethod = "totp" | "email" | "passkey";

export const OTP_PERIOD_MINUTES = 5;

export function twoFactorMethodOf(user: { twoFactorMethod?: string | null }): TwoFactorMethod {
  return user.twoFactorMethod === "email" || user.twoFactorMethod === "passkey"
    ? user.twoFactorMethod
    : "totp";
}

export function emailOtpAvailable() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendTwoFactorEmail(to: string, code: string) {
  const t = await getExtracted();
  const subject = t("Your Deni Run sign-in code: {code}", { code });
  const text = t(
    "Your Deni Run sign-in code is {code}. It expires in {minutes} minutes. If you did not try to sign in, you can ignore this email.",
    { code, minutes: String(OTP_PERIOD_MINUTES) },
  );
  const { renderSignInCodeEmail } = await loadEmailRenderer();
  const html = await renderSignInCodeEmail({
    lang: await getLocale(),
    code,
    preview: subject,
    heading: t("Your sign-in code"),
    intro: t("Enter this code to finish signing in to Deni Run."),
    expiry: t("This code expires in {minutes} minutes.", { minutes: String(OTP_PERIOD_MINUTES) }),
    ignore: t("If you did not try to sign in, you can ignore this email."),
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}
