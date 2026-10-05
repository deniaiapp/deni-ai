import type { Metadata } from "next";
import { getExtracted } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { supportEmail, supportMailto } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getExtracted();
  return {
    title: t("Privacy Policy · Deni Run"),
    description: t("How Deni Run collects, uses, shares, protects, retains, and deletes your data."),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="pt-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage() {
  const t = await getExtracted();
  const email = supportEmail();
  const mail = supportMailto();
  const accountLink = (chunks: ReactNode) => (
    <Link href="/account" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
      <article className="deni-rise mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-secondary-foreground">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          {t("Back to Deni Run home")}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{t("Privacy Policy")}</h1>
        <p className="text-xs text-muted-foreground">{t("Last updated: October 5, 2026")}</p>
        <p>
          {t("This policy explains what data Deni Run (run.deniai.app, “Deni Run”, “we”) collects when you use the service, why we collect it, who receives it, how we protect it, and how you can delete it. Deni Run is a web application where AI teammates complete tasks for you on a private, isolated computer (browser, files, and terminal).")}
        </p>

        <Section title={t("1. Data we collect")}>
          <p>
            <strong className="font-medium text-foreground">{t("Account data.")}</strong>{" "}
            {t("When you sign in with Google or GitHub we receive your name, email address, profile picture, and the provider account ID. We also store the session records and the two-factor authentication secret and backup codes needed to sign you in.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Content you create.")}</strong>{" "}
            {t("Messages and tasks you give teammates, teammate settings and memory, routines, skills, connected tool settings, files in your workspace, and screenshots of the computer session.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Billing data.")}</strong>{" "}
            {t("If you subscribe to Pro, Stripe collects your payment details. We store only your plan, Stripe customer and subscription IDs, and usage counters. We never see or store your card number.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Technical data.")}</strong>{" "}
            {t("Session cookies, rate-limit counters, and server logs that may include IP address and request metadata, used to keep the service secure and working.")}
          </p>
        </Section>

        <Section title={t("2. Google user data")}>
          <p>
            {t("Deni Run offers Google Sign-In for authentication only. We request the openid, email, and profile scopes and receive your name, email address, profile picture, and Google account ID. We do not request access to Gmail, Google Drive, Google Calendar, Contacts, or any other Google service, and we do not read data from your Google account beyond this basic profile.")}
          </p>
          <p>
            {t("We use this information only to create and identify your account, show your name and picture in the app, link a GitHub login to the same account when you choose to, send billing receipts through Stripe, and contact you about the service.")}
          </p>
          <p>
            {t("Deni Run’s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We do not use Google user data for advertising, we do not sell it or transfer it to data brokers, we do not use it to train generalized AI or machine-learning models, and no human reads it except as needed for security, support you request, or legal compliance.")}
          </p>
        </Section>

        <Section title={t("3. How we use data")}>
          <p>
            {t("To provide the service: run your teammates and computer sessions, store your workspace, enforce plan limits, process payments, keep the service secure, prevent abuse, fix bugs, and answer support requests. We do not use your data for advertising or profiling, and we do not sell it.")}
          </p>
        </Section>

        <Section title={t("4. Who receives data")}>
          <p>
            {t("We share data only with the providers that run the product, and only what each needs:")}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Google and GitHub: sign-in. They tell us who you are; we send them no workspace content.")}</li>
            <li>{t("Stripe: billing. Receives your email address and payment details.")}</li>
            <li>{t("OpenRouter and the model providers it routes to: AI model requests. Receive the messages, files, and page content a teammate needs for a task. We do not send your Google profile data.")}</li>
            <li>{t("Steel: cloud browser sessions, which load the websites your teammate visits.")}</li>
            <li>{t("E2B: the isolated sandbox where terminal commands run.")}</li>
            <li>{t("Our database and S3-compatible object storage (typically Cloudflare R2) hosting providers.")}</li>
          </ul>
          <p>
            {t("We may also disclose data when required by law or to protect the rights, safety, and security of users and the service. If the service is sold or merged, data may transfer to the new operator under this policy.")}
          </p>
        </Section>

        <Section title={t("5. How we protect data")}>
          <p>
            {t("Every account is isolated: workspace files, browser sessions, and terminal sandboxes are scoped to your user ID and not shared with other accounts. Traffic is encrypted with HTTPS. Sign-in requires an authenticator-app second factor. Access to databases and storage is limited by credentials held only by the service. No system is perfectly secure, so we cannot guarantee absolute security.")}
          </p>
        </Section>

        <Section title={t("6. Retention and deletion")}>
          <p>
            {t.rich("We keep your data while your account is active. You can export a copy of stored account data, or delete your account, from <link>Account</link> at any time. Deleting the account cancels any subscription and removes your login, sessions, conversations, teammates, routines, skills, computer state, workspace files, and screenshots from our database and object storage. Records that tax or accounting law requires, such as Stripe invoices, are kept by Stripe for the legally required period. Backups and logs are overwritten on their normal rotation.", {
              link: accountLink,
            })}
          </p>
          <p>
            {t("You can also revoke Deni Run’s access to your Google account at any time from your Google Account security settings. To request deletion without signing in, contact us at the address below.")}
          </p>
        </Section>

        <Section title={t("7. Cookies")}>
          <p>
            {t("We use only the cookies needed to keep you signed in and to remember your language and theme. We do not use advertising or cross-site tracking cookies.")}
          </p>
        </Section>

        <Section title={t("8. Your rights and children")}>
          <p>
            {t("Depending on where you live, you may have the right to access, correct, export, or delete your data and to object to certain processing. Use the Account page or contact us. Deni Run is not directed to children under 16, and we do not knowingly collect their data.")}
          </p>
        </Section>

        <Section title={t("9. Changes to this policy")}>
          <p>
            {t("We will update this page and the date above when this policy changes, and we will notify signed-in users of material changes in the app or by email.")}
          </p>
        </Section>

        <Section title={t("10. Contact")}>
          <p>
            {mail ? (
              <a href={mail} className="text-foreground hover:underline">
                {email}
              </a>
            ) : (
              t("the operator of this deployment")
            )}
          </p>
        </Section>

        <p className="pt-4 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            {t("Terms of Service")}
          </Link>
        </p>
      </article>
    </main>
  );
}
