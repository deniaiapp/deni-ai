import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { headTranslator } from "@/i18n/head";
import { useExtracted } from "@/i18n/react";
import { supportEmail, supportMailto } from "@/lib/site";
import { PublicLayout } from "../components/public-layout";

export const Route = createFileRoute("/support")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Support · Deni Run") },
        {
          name: "description",
          content: t("Get help with Deni Run: contact support, connect and disconnect Slack, Notion, and Linear, approvals, and deleting your data."),
        },
      ],
    };
  },
  component: SupportPage,
});

function Question({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-2">
      <h3 className="pt-3 text-[0.925rem] font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function SupportPage() {
  const t = useExtracted();
  const email = supportEmail();
  const mail = supportMailto();
  const accountLink = (chunks: ReactNode) => (
    <Link to="/account" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  const privacyLink = (chunks: ReactNode) => (
    <Link to="/privacy" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  const integrationsLink = (chunks: ReactNode) => (
    <Link to="/integrations" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  const mailLink = (chunks: ReactNode) =>
    mail ? (
      <a href={mail} className="text-foreground hover:underline">
        {chunks}
      </a>
    ) : (
      chunks
    );
  return (
    <PublicLayout>
      <article className="deni-rise mx-auto max-w-2xl space-y-4 px-6 pb-20 pt-10 text-sm leading-relaxed text-secondary-foreground">
        <h1 className="text-2xl font-semibold text-foreground">{t("Support")}</h1>

        <section className="space-y-3 rounded-xl border border-foreground/10 bg-surface p-5">
          <h2 className="text-lg font-semibold text-foreground">{t("Contact us")}</h2>
          {mail ? (
            <p>
              {t.rich("Email <mail>{email}</mail> with what you were trying to do, what happened instead, and the email address of your Deni Run account. Screenshots help. We aim to reply within two business days.", {
                email,
                mail: mailLink,
              })}
            </p>
          ) : (
            <p>{t("Contact the operator of this deployment for help.")}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("Never send passwords, sign-in codes, or access tokens. We will never ask for them.")}
          </p>
        </section>

        <h2 className="pt-4 text-lg font-semibold text-foreground">{t("Frequently asked questions")}</h2>

        <Question id="connect" title={t("How do I connect Slack, Notion, Linear, or another app?")}>
          <p>
            {t("In your workspace, open Plugins, click Browse connectors, search for the app, and click Connect. You sign in on the app’s own site and choose what to allow; Deni Run never sees your password. When you come back, the connector shows Connected and any teammate can use it.")}
          </p>
          <p>
            {t.rich("You can also start from the app’s page under <link>Integrations</link>, for example the “Add to Slack” button. If you are not signed in yet, you sign in first and the connection starts right after.", {
              link: integrationsLink,
            })}
          </p>
        </Question>

        <Question id="approval" title={t("What needs my approval, and what does “Always allow” do?")}>
          <p>
            {t("Tools that a connector marks as read-only, such as searching and reading, run without asking. Every other call, such as posting a message or editing a page, pauses the task and shows an approval card with the tool and what it will send. Nothing is sent until you approve, and if you deny, that step does not run.")}
          </p>
          <p>
            {t("“Always allow” is set per connection and per tool in Plugins. When it is on for a tool, a teammate can use that tool without asking you each time. Turn it off in the same menu at any time. For custom MCP servers every tool asks first, even ones the server calls read-only, unless you always allow it.")}
          </p>
          <p>
            {t("Background runs that no one is watching cannot wait for an answer, so there only read-only connector tools run and everything else is declined.")}
          </p>
        </Question>

        <Question id="disconnect" title={t("How do I disconnect an app?")}>
          <p>
            {t("Open Plugins in your workspace and click Disconnect on the app. Teammates lose access right away and Deni Run deletes the sign-in tokens it stored for that app.")}
          </p>
          <p>
            {t("To remove access on the app’s side as well:")}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Slack: in Slack, open Tools & settings → Manage apps and remove Deni Run, or ask a workspace admin to remove it.")}</li>
            <li>{t("Notion: disconnect Deni Run from the connections in your Notion settings.")}</li>
            <li>{t("Linear: revoke Deni Run from the authorized applications in your Linear account settings.")}</li>
            <li>{t("Other connectors: remove Deni Run from the connected or authorized apps in that service’s settings.")}</li>
            <li>{t("Gmail and Google Drive: remove Deni Run under third-party connections in your Google Account security settings.")}</li>
            <li>{t("GitHub: revoke Deni Run under Settings → Applications → Authorized OAuth Apps.")}</li>
            <li>{t("Discord: click Unlink in Plugins, or send /unlink to the bot.")}</li>
          </ul>
        </Question>

        <Question id="sign-in-again" title={t("A connector says “Needs sign-in again”. What do I do?")}>
          <p>
            {t("The app no longer accepts the saved sign-in. This happens when access was removed on the app’s side, the sign-in expired and could not be renewed, or a workspace admin changed what apps may do. Open Plugins and click Reconnect on that connector to sign in again; your Always allow choices stay as they were.")}
          </p>
          <p>
            {t("If it keeps asking, disconnect the connector, connect it again, and check that your account on that app can still see what the task needs.")}
          </p>
        </Question>

        <Question id="slack-workspaces" title={t("Which Slack workspaces does Deni Run work in?")}>
          <p>
            {t("Any Slack workspace you belong to that allows the app. During sign-in Slack shows which workspace you are connecting; to use a different one, switch workspaces on that screen. Teammates act as you, so they only see the channels, messages, and people your Slack account can see, and messages they post appear as sent by you.")}
          </p>
          <p>
            {t("If your workspace only allows approved apps, Slack asks you to request approval and a workspace admin must approve Deni Run before you can finish connecting. One Slack connection is kept per Deni Run account; connecting again replaces it.")}
          </p>
        </Question>

        <Question id="not-set-up" title={t("Connecting fails with “This connector is not set up on this server yet”.")}>
          <p>
            {t("That connector needs app credentials that this deployment has not configured. On run.deniai.app this should not happen, so contact us and we will fix it. If you run your own copy of Deni Run, register an app with the provider (for Slack, set SLACK_MCP_CLIENT_ID and SLACK_MCP_CLIENT_SECRET) and restart the server.")}
          </p>
          <p>
            {t("Other connection errors are usually cancelled sign-ins or an expired sign-in link. Click Connect again from Plugins and finish the sign-in within a few minutes.")}
          </p>
        </Question>

        <Question id="delete-data" title={t("How do I delete my data or my account?")}>
          <p>
            {t.rich("Disconnecting an app deletes the tokens for it. To export or delete everything, go to <account>Account</account>: deleting your account cancels any subscription and removes your conversations, teammates, connections, workspace files, and computer state. Messages a teammate already posted in Slack or other apps stay there until you delete them in that app. See the <privacy>Privacy Policy</privacy> for what we keep and why.", {
              account: accountLink,
              privacy: privacyLink,
            })}
          </p>
          {mail ? (
            <p>
              {t.rich("Can’t sign in? Email <mail>{email}</mail> from the address on your account to request deletion.", {
                email,
                mail: mailLink,
              })}
            </p>
          ) : null}
        </Question>
      </article>
    </PublicLayout>
  );
}
