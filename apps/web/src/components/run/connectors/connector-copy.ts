import { useExtracted } from "use-intl";
import type { McpCatalogCategory, McpCatalogId } from "@deniai/run/mcp/catalog";

/** One line per connector, shown on its gallery card and detail page. */
export function useConnectorDescriptions(): Record<McpCatalogId, string> {
  const t = useExtracted();
  return {
    notion: t("Search, read, and update pages and databases in Notion."),
    linear: t("Find, create, and update issues and projects in Linear."),
    slack: t("Search messages and channels, and post to Slack."),
    atlassian: t("Search and update Jira issues and Confluence pages."),
    monday: t("Read and update boards, items, and updates in monday.com."),
    clickup: t("Find, create, and update tasks and docs in ClickUp."),
    airtable: t("Read and update records in your Airtable bases."),
    granola: t("Search and read your meeting notes and transcripts in Granola."),
    dropbox: t("Search and read files in your Dropbox."),
    zapier: t("Run the actions you set up in Zapier across thousands of apps."),
    intercom: t("Search conversations, tickets, and contacts in Intercom."),
    canva: t("Search, create, and edit designs in Canva."),
    miro: t("Read Miro boards and add content to them."),
    webflow: t("Read and update sites, pages, and CMS collections in Webflow."),
    wix: t("Manage your Wix sites, content, and business apps."),
    attio: t("Search and update people, companies, and deals in Attio."),
    close: t("Find and update leads, contacts, and opportunities in Close."),
    stripe: t("Look up customers, payments, and subscriptions in Stripe."),
    paypal: t("Look up transactions, and manage invoices and orders in PayPal."),
    square: t("Look up payments, orders, catalog items, and customers in Square."),
    sentry: t("Search issues and errors, and read stack traces in Sentry."),
    supabase: t("Query databases and manage projects in Supabase."),
    neon: t("Run SQL and manage projects and branches in Neon Postgres."),
    cloudflare: t("Manage Workers, DNS, and other resources in your Cloudflare account."),
    posthog: t("Query product analytics, feature flags, and errors in PostHog."),
    huggingface: t("Search models, datasets, Spaces, and papers on Hugging Face."),
    context7: t("Look up current documentation and code examples for libraries."),
    deepwiki: t("Ask questions about public GitHub repositories and read their docs."),
  };
}

export const CONNECTOR_CATEGORY_ORDER: McpCatalogCategory[] = [
  "productivity",
  "communication",
  "design",
  "sales",
  "payments",
  "developer",
];

export function useConnectorCategories(): Record<McpCatalogCategory, string> {
  const t = useExtracted();
  return {
    productivity: t("Productivity"),
    communication: t("Communication"),
    design: t("Design and websites"),
    sales: t("Sales"),
    payments: t("Payments"),
    developer: t("Developer tools"),
  };
}

export type ConnectorDetails = {
  tagline: string;
  can: string[];
  examples: string[];
  access: string;
  revoke: string;
};

/** Longer copy for the connectors with a detail write-up; others show their description. */
export function useConnectorDetails(id: string): ConnectorDetails | null {
  const t = useExtracted();
  switch (id) {
    case "slack":
      return {
        tagline: t(
          "Let your AI teammates search Slack, catch up on channels and threads, and post updates for you, with your approval.",
        ),
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
        access: t(
          "Deni Run works in any Slack workspace you belong to that allows the app. Teammates act as you, so they only see the channels, messages, and people your Slack account can see. If your workspace only allows approved apps, Slack asks you to request approval from a workspace admin first.",
        ),
        revoke: t(
          "To remove access on Slack’s side as well, open Tools & settings → Manage apps in Slack and remove Deni Run, or ask a workspace admin to remove it.",
        ),
      };
    case "notion":
      return {
        tagline: t(
          "Let your AI teammates find, read, and update pages and databases in Notion, with your approval for every change.",
        ),
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
        access: t(
          "Notion asks which workspace and pages to share when you connect. Teammates act as you and only see what you shared with the integration.",
        ),
        revoke: t(
          "To remove access on Notion’s side as well, disconnect Deni Run from the connections in your Notion settings.",
        ),
      };
    case "linear":
      return {
        tagline: t(
          "Let your AI teammates find, create, and update Linear issues and projects, with your approval for every change.",
        ),
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
        access: t(
          "Teammates act as you in the Linear workspace you choose when you connect, and see only the teams and issues your account can see.",
        ),
        revoke: t(
          "To remove access on Linear’s side as well, revoke Deni Run from the authorized applications in your Linear account settings.",
        ),
      };
    default:
      return null;
  }
}
