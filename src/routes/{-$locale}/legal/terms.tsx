import { useExtracted } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/extracted";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/legal/terms")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    return pageHead({
      title: t("Terms of Service"),
      description: t("The terms and conditions for using Deni AI."),
      alternates: { path: "/legal/terms", locale: intl.locale },
    });
  },
  component: TermsPage,
});

function TermsPage() {
  const t = useExtracted();
  return (
    <main className="min-h-screen bg-background" id="main-content">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("Last updated: 2026-08-09")}</p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("Terms of Service")}
          </h1>
          <p className="text-base text-muted-foreground">
            {t(
              'These Terms of Service (the "Terms") govern your access to and use of Deni AI (the "Service"). By accessing or using the Service, you agree to be bound by these Terms.',
            )}
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("1. Eligibility")}</h2>
          <p className="text-muted-foreground">
            {t(
              "You must be at least 13 years old to use the Service. If you are using the Service on behalf of an organization, you represent and warrant that you have authority to bind that organization to these Terms.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("2. Accounts and Security")}</h2>
          <p className="text-muted-foreground">
            {t(
              "You are responsible for the accuracy of the information you provide and for maintaining the security of your account. You agree not to share your login credentials and to notify us immediately of any unauthorized access or use of your account.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("3. Acceptable Use")}</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>{t("Do not use the Service for unlawful, harmful, or abusive activity.")}</li>
            <li>
              {t(
                "Do not engage in spam, mass account creation, automated abuse, fraud, or other deceptive practices.",
              )}
            </li>
            <li>{t("Do not attempt to reverse engineer or interfere with the Service.")}</li>
            <li>
              {t(
                "Do not upload content that infringes on the rights of others or violates applicable laws.",
              )}
            </li>
            <li>
              {t(
                "Do not attempt to access, probe, or test the vulnerability of the Service without authorization.",
              )}
            </li>
            <li>
              {t(
                "Deni AI Flixa may only be used with approved, authenticated clients: Codex, Claude Code, OpenCode, Flixa, and Flixa CLI. Using any other client, proxy, or unauthorized tool with Deni AI Flixa may result in a Flixa ban (including suspension or permanent loss of Flixa access) without prior notice.",
              )}
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("4. Your Content")}</h2>
          <p className="text-muted-foreground">
            {t(
              "You retain ownership of the content you submit to the Service. You grant Deni AI a limited license to host, store, and process your content solely to operate, maintain, and improve the Service.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "You are responsible for your content and for decisions or actions you take based on content generated or exported from the Service.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("5. AI Output")}</h2>
          <p className="text-muted-foreground">
            {t(
              "The Service may generate responses that are inaccurate, incomplete, or inappropriate. You are responsible for evaluating output before relying on it. Deni AI does not provide professional advice.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("6. Paid Features")}</h2>
          <p className="text-muted-foreground">
            {t(
              "If paid plans are offered, pricing and billing terms will be presented at purchase. You are responsible for applicable taxes and fees.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "Digital access to the Service is granted immediately after payment. Because the Service is a digital product delivered at once, paid plans are generally non-refundable once access has been provided, except where required by applicable law.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "You may cancel a subscription at any time from Billing settings or the customer portal. Cancellation takes effect at the end of the current billing period unless stated otherwise at purchase. You remain responsible for charges incurred before cancellation takes effect.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "If you believe a charge is in error, contact us at contact@deniai.app before disputing the charge with your payment provider. We may contest chargebacks when the account used the Service after payment.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "Deni AI Ads are prepaid. Advertisers may choose ¥200 per 1,000 billable views, ¥30 per billable click, or ¥3,000 for one fixed chat slot for 30 days. Automated review may reject ads before purchase. Advertisers are responsible for their claims and destination sites; approval does not guarantee legality or performance. Contact us about billing errors or unused ad budget.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("7. Intellectual Property")}</h2>
          <p className="text-muted-foreground">
            {t(
              "The Service, including its software and design, is owned by Deni AI and protected by applicable laws. You may not copy, modify, or distribute any part of the Service without prior written consent.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("8. Termination")}</h2>
          <p className="text-muted-foreground">
            {t(
              "We may suspend or terminate your access to the Service at any time if you violate these Terms or if required to protect the Service or other users.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "In particular, if we detect spam, mass signup, fraud, automated abuse, or other unauthorized or harmful activity, we may delete the related accounts and associated data without prior notice when reasonably necessary to protect the Service, other users, or our infrastructure.",
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "We may also ban, suspend, or permanently revoke Deni AI Flixa access if Flixa is used with clients other than the approved authenticated clients listed above (Codex, Claude Code, OpenCode, Flixa, and Flixa CLI).",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("9. Disclaimers")}</h2>
          <p className="text-muted-foreground">
            {t(
              'The Service is provided on an "as is" and "as available" basis without warranties of any kind. To the maximum extent permitted by law, we disclaim all warranties, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement.',
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("10. Limitation of Liability")}</h2>
          <p className="text-muted-foreground">
            {t(
              "To the maximum extent permitted by law, Deni AI will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("11. Changes to These Terms")}</h2>
          <p className="text-muted-foreground">
            {t(
              "We may update these Terms from time to time. If we make material changes, we will provide notice by updating the date above or by other reasonable means. Continued use of the Service after changes become effective constitutes acceptance of the updated Terms.",
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t("12. Contact")}</h2>
          <p className="text-muted-foreground">
            {t("If you have questions about these Terms, contact us at:")}
          </p>
          <p className="text-muted-foreground">contact@deniai.app</p>
        </section>
      </div>
    </main>
  );
}
