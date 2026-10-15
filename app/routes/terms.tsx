import { createFileRoute, Link } from "@tanstack/react-router";
import { useExtracted } from "@/i18n/react";
import { supportEmail, supportMailto } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  const t = useExtracted();
  const email = supportEmail();
  const mail = supportMailto();
  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
      <article className="deni-rise mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-secondary-foreground">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          {t("Back")}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{t("Terms of Service")}</h1>
        <p>
          {t("Deni Run is an AI teammate service that can operate a private computer (browser, files, and terminal) on your behalf. By creating an account you agree to these terms.")}
        </p>
        <p>
          {t("You are responsible for the tasks you assign, including browsing, file changes, and shell commands. Do not use Deni Run to break the law, attack systems, send spam, or process data you are not allowed to handle. Destructive actions may require your approval, but you remain responsible for the outcome.")}
        </p>
        <p>
          {t("You must not use Deni Run to create, edit, or distribute sexual or intimate imagery of a real person without their consent, including AI-generated imagery, or any sexual content involving minors. We remove such content and suspend and report the accounts involved.")}
        </p>
        <p>
          {t("Usage limits apply by plan. Paid subscriptions renew monthly until canceled through the billing portal. Fees are charged by Stripe. We may suspend accounts that abuse infrastructure, exceed fair use, or violate these terms.")}
        </p>
        <p>
          {t.rich("Computer sessions, files, and memory stay scoped to your account. You can export or delete that data from <link>Account</link>. Deleting your account also removes the login stored for this service.", {
            link: (chunks) => (
              <Link to="/account" className="text-foreground hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
        <p>
          {t("If you link a Discord account, you are responsible for who can use that account. Anyone who can send direct messages from it can use your workspace much as you can in the app, except account and billing settings: give your teammates tasks, approve actions with the Approve button, change teammates, groups, skills, routines, and plugins, and read or delete workspace files. Discord’s own terms and privacy policy apply to your use of Discord. You can unlink at any time from Plugins or with /unlink.")}
        </p>
        <p>
          {t.rich("Our <link>Privacy Policy</link> explains how we handle your data, including information received from Google sign-in.", {
            link: (chunks) => (
              <Link to="/privacy" className="text-foreground hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
        <p>
          {t("The service is provided as-is. We do not warrant uninterrupted availability. These terms may be updated as the product changes.")}
        </p>
        <p>
          {t("Contact:")}{" "}
          {mail ? (
            <a href={mail} className="text-foreground hover:underline">
              {email}
            </a>
          ) : (
            t("the operator of this deployment")
          )}
        </p>
      </article>
    </main>
  );
}
