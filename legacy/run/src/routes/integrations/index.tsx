import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { headTranslator } from "@/i18n/head";
import { useExtracted } from "@/i18n/react";
import { mcpCatalog, type McpCatalogEntry } from "@/lib/mcp/catalog";
import { ConnectorGallery } from "@/components/connectors/connector-gallery";
import { connectHref } from "@/components/connectors/connector-landing";
import { PublicLayout } from "@/components/marketing/public-layout";

export const Route = createFileRoute("/integrations/")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Integrations · Deni Run") },
        {
          name: "description",
          content: t("Apps Deni Run teammates can work with: Slack, Notion, Linear, Jira, Sentry, Stripe, and more connectors, plus Gmail, Google Drive, GitHub, Discord, and your own MCP servers."),
        },
      ],
    };
  },
  component: IntegrationsPage,
});

const card =
  "flex h-full flex-col gap-3 rounded-xl border border-foreground/10 bg-surface p-5 transition-transform duration-200 hover:-translate-y-1";

function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-semibold text-black ring-1 ring-foreground/10">
      {children}
    </span>
  );
}

type LandingPath = "/integrations/slack" | "/integrations/notion" | "/integrations/linear";
type Item = { key: string; name: string; body: string; mark: ReactNode; to?: LandingPath };

/** Connectors with their own page; the rest start connecting straight from the gallery. */
const landingPages: Partial<Record<string, LandingPath>> = {
  slack: "/integrations/slack",
  notion: "/integrations/notion",
  linear: "/integrations/linear",
};

function IntegrationCard({ item, cta }: { item: Item; cta: string }) {
  const content = (
    <>
      <div className="flex items-center gap-3">
        <Mark>{item.mark}</Mark>
        <h3 className="text-[0.925rem] font-semibold">{item.name}</h3>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
      {item.to ? <span className="text-xs font-medium text-foreground">{cta} →</span> : null}
    </>
  );
  return (
    <li>
      {item.to ? (
        <Link to={item.to} className={card}>
          {content}
        </Link>
      ) : (
        <div className={card}>{content}</div>
      )}
    </li>
  );
}

function IntegrationsPage() {
  const t = useExtracted();
  const connectorAction = (entry: McpCatalogEntry) => {
    const to = landingPages[entry.id];
    const link = "shrink-0 text-xs font-medium text-foreground hover:underline";
    return to ? (
      <Link to={to} className={link}>
        {t("Learn more")} →
      </Link>
    ) : (
      <a href={connectHref(entry.id)} className={link}>
        {t("Connect {name}", { name: entry.name })} →
      </a>
    );
  };
  const builtIn: Item[] = [
    { key: "gmail", name: "Gmail", mark: "M", body: t("Search and read your mail, and send email on your behalf after you approve.") },
    { key: "drive", name: "Google Drive", mark: "D", body: t("Search and read Docs and text files, and create or update files the app made after you approve.") },
    { key: "github", name: "GitHub", mark: "GH", body: t("Read repositories, issues, pull requests, and workflow runs. Open issues and pull requests, comment, review, and merge after you approve.") },
  ];
  const other: Item[] = [
    { key: "discord", name: "Discord", mark: "DC", body: t("Link your Discord account to give teammates tasks, approve actions, and get notified from a direct message with the Deni Run bot.") },
    { key: "mcp", name: t("Custom MCP servers"), mark: "MCP", body: t("Connect any streamable HTTP or SSE MCP server, with a bearer token or OAuth sign-in. Every call asks first unless you always allow that tool.") },
  ];
  const groups = [
    { title: t("Built-in plugins"), body: t("Sign in with Google or GitHub to let teammates use these services."), items: builtIn },
    { title: t("More ways to work"), body: t("Reach your teammates from Discord, or bring your own tools."), items: other },
  ];
  return (
    <PublicLayout>
      <div className="mx-auto max-w-5xl space-y-14 px-6 pb-20 pt-10">
        <section className="deni-rise max-w-2xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{t("Integrations")}</h1>
          <p className="text-[0.925rem] leading-relaxed text-muted-foreground">
            {t("Connect the apps you already use so AI teammates can find information and get work done there. Everything is off until you connect it, and changes wait for your approval. Connect and disconnect any of them from Plugins in your workspace.")}
          </p>
        </section>
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{t("Connectors")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("One click to connect. You sign in on the app’s own site; Deni Run never sees your password.")}{" "}
              {t("Search {count} apps or filter by category.", { count: String(mcpCatalog.length) })}
            </p>
          </div>
          <ConnectorGallery listClassName="gap-4 lg:grid-cols-3" cardClassName="bg-surface p-5" renderAction={connectorAction} />
        </section>
        {groups.map((group) => (
          <section key={group.title} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">{group.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{group.body}</p>
            </div>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <IntegrationCard key={item.key} item={item} cta={t("Learn more")} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicLayout>
  );
}
