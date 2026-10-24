import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useExtracted } from "@/i18n/react";
import { mcpCatalogEntry, type McpCatalogId } from "@/lib/mcp-catalog";
import { ConnectorLogo } from "./connector-logos";
import { PublicLayout } from "./public-layout";

const card = "rounded-xl border border-foreground/10 bg-surface p-5";

/** Starts the real flow: the workspace opens Plugins and connects; signed-out visitors sign in first. */
export function connectHref(id: McpCatalogId) {
  return `/?plugins=1&connect=${id}`;
}

/** The "Add to Slack" style button: white, bordered, brand mark, the same in light and dark themes. */
export function AddToButton({ id, label }: { id: McpCatalogId; label: string }) {
  return (
    <a
      href={connectHref(id)}
      className="inline-flex h-12 items-center gap-3 rounded-md border border-black/15 bg-white px-5 text-base font-semibold text-black shadow-sm transition-transform hover:bg-neutral-50 active:scale-[0.98]"
    >
      <ConnectorLogo id={id} className="size-6" />
      <span>{label}</span>
    </a>
  );
}

function useConnectorCopy(id: McpCatalogId) {
  const t = useExtracted();
  switch (id) {
    case "slack":
      return {
        tagline: t("Let your AI teammates search Slack, catch up on channels and threads, and post updates for you, with your approval."),
        can: [
          t("Search messages, channels, and people you can see"),
          t("Read channel history and whole threads to catch you up"),
          t("Post messages and replies, after you approve each one"),
        ],
        examples: [
          t("Summarize what happened in #product this week and save the notes to my workspace."),
          t("Find the thread where we picked the launch date and tell me who decided."),
          t("Collect every customer question from #support today into a spreadsheet."),
          t("Draft a status update from my open Linear issues and post it to #team-updates."),
        ],
        access: t("Deni Run works in any Slack workspace you belong to that allows the app. Teammates act as you, so they only see the channels, messages, and people your Slack account can see. If your workspace only allows approved apps, Slack asks you to request approval from a workspace admin first."),
        revoke: t("To remove access on Slack’s side as well, open Tools & settings → Manage apps in Slack and remove Deni Run, or ask a workspace admin to remove it."),
      };
    case "notion":
      return {
        tagline: t("Let your AI teammates find, read, and update pages and databases in Notion, with your approval for every change."),
        can: [
          t("Search pages and databases you have access to"),
          t("Read pages to answer questions or gather research"),
          t("Create and update pages and database entries, after you approve"),
        ],
        examples: [
          t("Find our onboarding checklist in Notion and turn it into a task list."),
          t("Read the Q3 planning page and summarize the open decisions."),
          t("Add a page to the meeting notes database with today’s summary."),
        ],
        access: t("Notion asks which workspace and pages to share when you connect. Teammates act as you and only see what you shared with the integration."),
        revoke: t("To remove access on Notion’s side as well, disconnect Deni Run from the connections in your Notion settings."),
      };
    case "linear":
      return {
        tagline: t("Let your AI teammates find, create, and update Linear issues and projects, with your approval for every change."),
        can: [
          t("Search issues, projects, and teams"),
          t("Read issues and comments to report status"),
          t("Create and update issues and comments, after you approve"),
        ],
        examples: [
          t("List my open Linear issues due this week, sorted by priority."),
          t("File a bug in Linear from the error in this screenshot."),
          t("Summarize what the platform team shipped this cycle."),
        ],
        access: t("Teammates act as you in the Linear workspace you choose when you connect, and see only the teams and issues your account can see."),
        revoke: t("To remove access on Linear’s side as well, revoke Deni Run from the authorized applications in your Linear account settings."),
      };
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function ConnectorLanding({ id }: { id: McpCatalogId }) {
  const t = useExtracted();
  const entry = mcpCatalogEntry(id);
  const copy = useConnectorCopy(id);
  const name = entry?.name ?? id;
  const privacyLink = (chunks: ReactNode) => (
    <Link to="/privacy" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  const supportLink = (chunks: ReactNode) => (
    <Link to="/support" className="text-foreground hover:underline">
      {chunks}
    </Link>
  );
  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl space-y-10 px-6 pb-20 pt-10 text-sm leading-relaxed text-secondary-foreground">
        <section className="deni-rise space-y-5">
          <Link to="/integrations" className="text-xs text-muted-foreground hover:text-foreground">
            {t("All integrations")}
          </Link>
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-foreground/10">
              <ConnectorLogo id={id} className="size-9" />
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("Deni Run for {name}", { name })}
            </h1>
          </div>
          <p className="max-w-2xl text-[0.925rem] text-muted-foreground">{copy.tagline}</p>
          <div className="flex flex-wrap items-center gap-4">
            <AddToButton id={id} label={t("Add to {name}", { name })} />
            <span className="text-xs text-muted-foreground">
              {t("Free to start. You sign in to Deni Run, then approve access on {name}.", { name })}
            </span>
          </div>
        </section>

        <Section title={t("What your teammates can do")}>
          <ul className="list-disc space-y-1 pl-5">
            {copy.can.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title={t("Example tasks")}>
          <ul className="grid gap-3 md:grid-cols-2">
            {copy.examples.map((item) => (
              <li key={item} className={card}>
                “{item}”
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("How it works")}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("Click “Add to {name}” and sign in to Deni Run with Google or GitHub.", { name })}</li>
            <li>{t("{name} asks you to allow access. Deni Run never sees your {name} password.", { name })}</li>
            <li>{t("Back in your workspace, give any teammate a task that needs {name}.", { name })}</li>
          </ol>
          <p>{copy.access}</p>
        </Section>

        <Section title={t("You approve every change")}>
          <p>
            {t("Tools that {name} marks as read-only, such as searching and reading, run without asking. Anything else, such as posting or editing, stops and shows you an approval card with what will be sent, and runs only after you approve it.", { name })}
          </p>
          <p>
            {t("If you trust a specific action, turn on Always allow for that tool in Plugins. In background runs that no one is watching, only read-only tools run and everything else is declined.")}
          </p>
        </Section>

        <Section title={t("Your data")}>
          <p>
            {t("Deni Run reads from {name} only to carry out a task you gave a teammate. What a teammate retrieves is sent to the AI model provider to produce the answer and may be kept in that conversation in your workspace. Sign-in tokens are stored encrypted and used only to call {name} for you. We do not sell your data or use it for advertising.", { name })}
          </p>
          <p>
            {t.rich("Disconnect any time from Plugins in the app, which deletes the stored tokens right away. {revoke} Details are in our <privacy>Privacy Policy</privacy>; questions go to <support>Support</support>.", {
              revoke: copy.revoke,
              privacy: privacyLink,
              support: supportLink,
            })}
          </p>
        </Section>

        <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
          <p className="text-[0.925rem] font-medium text-foreground">
            {t("Ready to hand off work in {name}?", { name })}
          </p>
          <AddToButton id={id} label={t("Add to {name}", { name })} />
        </section>
      </div>
    </PublicLayout>
  );
}
