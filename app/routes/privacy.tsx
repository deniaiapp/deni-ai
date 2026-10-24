import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { headTranslator } from "@/i18n/head";
import { useExtracted } from "@/i18n/react";
import { supportEmail, supportMailto } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Privacy Policy · Deni Run") },
        {
          name: "description",
          content: t("How Deni Run collects, uses, shares, protects, retains, and deletes your data."),
        },
      ],
    };
  },
  component: PrivacyPage,
});

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="pt-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function PrivacyPage() {
  const t = useExtracted();
  const email = supportEmail();
  const mail = supportMailto();
  const accountLink = (chunks: ReactNode) => (
    <Link to="/account" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
      <article className="deni-rise mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-secondary-foreground">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          {t("Back to Deni Run home")}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{t("Privacy Policy")}</h1>
        <p className="text-xs text-muted-foreground">{t("Last updated: October 24, 2026")}</p>
        <p>
          {t("This policy explains what data Deni Run (run.deniai.app, “Deni Run”, “we”) collects when you use the service, why we collect it, who receives it, how we protect it, and how you can delete it. Deni Run is a web application where AI teammates complete tasks for you on a private, isolated computer (browser, files, and terminal).")}
        </p>

        <Section title={t("1. Data we collect")}>
          <p>
            <strong className="font-medium text-foreground">{t("Account data.")}</strong>{" "}
            {t("When you sign in with Google or GitHub we receive your name, email address, profile picture, and the provider account ID. We also store the session records and what your two-factor method needs to sign you in: the authenticator secret and backup codes, or the public key of your passkey. Fingerprints and face data never leave your device.")}
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
            <strong className="font-medium text-foreground">{t("Discord data.")}</strong>{" "}
            {t("Only if you link Discord from Plugins in the app, we store your Discord user ID and username, the language of the session that created the link, which teammate or group you are talking to, and whether you want notifications there. The messages you send to the Deni Run bot in a direct message and the replies are saved in that conversation in your workspace, like any other message, and files you attach are saved in your workspace inbox. We read only direct messages sent to the bot, never server channels, and the bot does not request the Message Content privileged intent.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Technical data.")}</strong>{" "}
            {t("Session cookies, rate-limit counters, and server logs that may include IP address and request metadata, used to keep the service secure and working.")}
          </p>
        </Section>

        <Section title={t("2. Google user data")}>
          <p>
            <strong className="font-medium text-foreground">{t("Google Sign-In.")}</strong>{" "}
            {t("When you sign in with Google we request only the openid, email, and profile scopes and receive your name, email address, profile picture, and Google account ID. We use them to create and identify your account, show your name and picture in the app, link a GitHub login to the same account when you choose to, send billing receipts through Stripe, and contact you about the service.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Optional Gmail and Google Drive plugins.")}</strong>{" "}
            {t("Only if you choose to connect them from Plugins in the app, Deni Run asks Google for additional access. Each permission is requested separately and you can decline it. The permissions are:")}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Gmail, read-only (gmail.readonly): lets a teammate search your mail and read the sender, recipient, date, subject, and text of messages it needs for a task you gave it.")}</li>
            <li>{t("Gmail, send (gmail.send): lets a teammate send an email on your behalf. Each message needs your approval unless you turn on “always allow” for sending.")}</li>
            <li>{t("Google Drive, read-only (drive.readonly): lets a teammate search your Drive by file name and read Google Docs and text files it needs for a task you gave it.")}</li>
            <li>{t("Google Drive, files created by the app (drive.file): lets a teammate create new files, and update files it created, in your Drive. Each change needs your approval unless you turn on “always allow”.")}</li>
          </ul>
          <p>
            {t("These permissions are used only to carry out the tasks you ask a teammate to do, and only when you ask. We do not scan, index, or copy your whole mailbox or Drive. Content retrieved for a task is sent to the AI model provider listed below to produce the response you see, and may be kept in that task’s conversation history in your workspace. Google access tokens are stored in our database and used only to call Google APIs for you.")}
          </p>
          <p>
            {t("Deni Run’s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We do not use Google user data for advertising, we do not sell it or transfer it to data brokers, we do not use it to develop, improve, or train generalized AI or machine-learning models, and we do not allow humans to read it unless you give consent for specific items, it is necessary for security or abuse investigation, or the law requires it.")}
          </p>
        </Section>

        <Section title={t("3. Connectors: Slack, Notion, Linear, and custom MCP servers")}>
          <p>
            {t("Only if you choose to connect them from Plugins in the app, or with the Add to Slack button, teammates can use these services through their official Model Context Protocol (MCP) servers. You sign in on the service’s own site and choose what to allow there; Deni Run never sees your password for that service.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("What we store.")}</strong>{" "}
            {t("For each connection: its name and server address, the OAuth client details and access and refresh tokens the service issues, which tools you set to “Always allow”, and when it was last checked. Tokens are encrypted with AES-256-GCM before they are stored and are used only to call that service for you. We do not copy or index your workspace in any of these services.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Slack.")}</strong>{" "}
            {t("Slack gives Deni Run a user token, so teammates act as you, with your access: they cannot see channels or conversations you cannot see, and messages they send appear under your name. The permissions requested let a teammate, when you ask, search and read messages, files, canvases, lists, and people in conversations you belong to; send or schedule messages; create conversations, canvases, and lists; upload files; and add reactions. Before you approve an action, Deni Run looks up the names of the channels and people it involves with Slack’s read-only tools, so the approval shows “#general” instead of an ID; these names are kept in memory for up to ten minutes.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Notion and Linear.")}</strong>{" "}
            {t("Teammates can search and read pages, databases, issues, and projects you have access to, and create or update them when you ask.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("When teammates act.")}</strong>{" "}
            {t("Only while carrying out a task you gave them. Tools the service marks as read-only run without asking. Anything else, such as sending a message or changing a page, is shown to you with what it will do and runs only after you approve it, unless you turned on “Always allow” for that exact tool. For custom MCP servers you add yourself, every call needs your approval unless you allowed that tool.")}
          </p>
          <p>
            <strong className="font-medium text-foreground">{t("Where the content goes.")}</strong>{" "}
            {t("Content a teammate retrieves is sent to the AI model provider listed below to produce the response you see, and may be kept in that task’s conversation history in your workspace. We do not use data from these services for advertising, we do not sell it, we do not use it to train or improve AI or machine-learning models, and people at Deni Run do not read it unless you ask us to for support, it is needed to investigate security or abuse, or the law requires it.")}
          </p>
        </Section>

        <Section title={t("4. How we use data")}>
          <p>
            {t("To provide the service: run your teammates and computer sessions, store your workspace, enforce plan limits, process payments, keep the service secure, prevent abuse, fix bugs, and answer support requests. We do not use your data for advertising or profiling, and we do not sell it.")}
          </p>
        </Section>

        <Section id="sub-processors" title={t("5. Who receives data")}>
          <p>
            {t("We share data only with the providers that run the product, and only what each needs:")}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Google and GitHub: sign-in and the plugins you connect. We send them only the requests needed to sign you in or to carry out an action you asked for, such as sending an email.")}</li>
            <li>{t("Discord: if you link it, Discord carries the direct messages you and the bot exchange, including files and screenshots you request and notifications about background work if you keep them on, under Discord’s own terms and privacy policy. Do not send anything you would not want Discord to process. Message content is used only to answer you and is not used to train AI models.")}</li>
            <li>{t("Slack, Notion, Linear, and custom MCP servers you connect: receive the requests a teammate makes for a task you gave it, under each service’s own terms and privacy policy.")}</li>
            <li>{t("Stripe: billing. Receives your email address and payment details.")}</li>
            <li>{t("Resend: delivers sign-in codes if you choose email for two-factor. Receives your email address and the code.")}</li>
            <li>{t("OpenRouter and the model providers it routes to: AI model requests. Receive the messages, files, page content, and, if you connected Gmail, Google Drive, Slack, Notion, Linear, or another MCP server, the content a teammate retrieves from it for a task. They are used only to respond to that task and are not used by us to train models. We do not send your Google profile data.")}</li>
            <li>{t("Steel: cloud browser sessions, which load the websites your teammate visits.")}</li>
            <li>{t("E2B: the isolated sandbox where terminal commands run.")}</li>
            <li>{t("Cloudflare: database (D1) and file storage (R2), in Japan.")}</li>
            <li>{t("Contabo: the servers that run the app, in Japan.")}</li>
          </ul>
          <p>
            {t("We may also disclose data when required by law or to protect the rights, safety, and security of users and the service. If the service is sold or merged, data may transfer to the new operator under this policy.")}
          </p>
        </Section>

        <Section title={t("6. How we protect data")}>
          <p>
            {t("Every account is isolated: workspace files, browser sessions, and terminal sandboxes are scoped to your user ID and not shared with other accounts. Traffic is encrypted with HTTPS. Sign-in requires a second factor: a passkey, an emailed code, or a code from an authenticator app. Access to databases and storage is limited by credentials held only by the service. No system is perfectly secure, so we cannot guarantee absolute security.")}
          </p>
        </Section>

        <Section title={t("7. Retention and deletion")}>
          <p>
            {t.rich("We keep your data while your account is active. You can export a copy of stored account data, or delete your account, from <link>Account</link> at any time. Deleting the account cancels any subscription and removes your login, sessions, conversations, teammates, routines, skills, computer state, workspace files, and screenshots from our database and object storage. Records that tax or accounting law requires, such as Stripe invoices, are kept by Stripe for the legally required period. Backups and logs are overwritten on their normal rotation.", {
              link: accountLink,
            })}
          </p>
          <p>
            {t("You can unlink Discord at any time from Plugins in the app or by sending /unlink to the bot. Unlinking deletes the stored link and any unused link code, and the bot stops answering that Discord account. Deleting your Deni Run account does the same. Messages already delivered in Discord stay in your Discord account until you delete them there.")}
          </p>
          <p>
            {t("You can disconnect the Gmail, Google Drive, and GitHub plugins at any time from Plugins in the app, which stops teammates using them right away and revokes our access at Google or GitHub once the last plugin of that provider is disconnected. You can also revoke Deni Run’s access to Gmail, Google Drive, or your whole Google account from your Google Account security settings; access stops immediately. Deleting your Deni Run account also deletes the Google access tokens we hold. To request deletion without signing in, contact us at the address below.")}
          </p>
          <p>
            {t("You can disconnect Slack, Notion, Linear, or any MCP server at any time from Plugins in the app, which deletes the tokens we hold for it right away. To also revoke the grant on the service’s side, remove Deni Run from that service’s connected or authorized apps (in Slack, from your workspace’s app management page). Deleting your Deni Run account deletes every connection and its tokens.")}
          </p>
        </Section>

        <Section title={t("8. Cookies")}>
          <p>
            {t("We use only the cookies needed to keep you signed in and to remember your language and theme. We do not use advertising or cross-site tracking cookies.")}
          </p>
        </Section>

        <Section title={t("9. Your rights and children")}>
          <p>
            {t("Depending on where you live, you may have the right to access, correct, export, or delete your data and to object to certain processing. Use the Account page or contact us. Deni Run is not directed to children under 16, and we do not knowingly collect their data.")}
          </p>
        </Section>

        <Section title={t("10. Changes to this policy")}>
          <p>
            {t("We will update this page and the date above when this policy changes, and we will notify signed-in users of material changes in the app or by email.")}
          </p>
        </Section>

        <Section title={t("11. Contact")}>
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
          <Link to="/terms" className="hover:text-foreground">
            {t("Terms of Service")}
          </Link>
        </p>
      </article>
    </main>
  );
}
