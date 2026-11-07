import { useState, type ReactNode } from "react";
import { SearchIcon, SearchXIcon } from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { useExtracted } from "@/i18n/react";
import { mcpCatalog, type McpCatalogCategory, type McpCatalogEntry, type McpCatalogId } from "@/lib/mcp/catalog";
import { cn } from "@/lib/utils";
import { ConnectorLogo } from "./connector-logos";

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

const categoryOrder: McpCatalogCategory[] = ["productivity", "communication", "design", "sales", "payments", "developer"];

/** Every typed word must appear in the name, id, keywords, description, or category. */
function matches(entry: McpCatalogEntry, words: string[], description: string, category: string) {
  const text = [entry.name, entry.id, ...(entry.keywords ?? []), description, category].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Searchable grid of the one-click connectors, filtered by category. Callers supply each card's
 * action (Connect, Learn more) and, in the app, its connection status.
 */
export function ConnectorGallery({ renderAction, renderStatus, empty, listClassName, cardClassName, autoFocus }: {
  renderAction: (entry: McpCatalogEntry) => ReactNode;
  renderStatus?: (entry: McpCatalogEntry) => ReactNode;
  /** Shown under the no-results message, such as a way to add a custom server. */
  empty?: ReactNode;
  listClassName?: string;
  cardClassName?: string;
  autoFocus?: boolean;
}) {
  const t = useExtracted();
  const descriptions = useConnectorDescriptions();
  const categories = useConnectorCategories();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCatalogCategory | null>(null);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = mcpCatalog.filter((entry) => matches(entry, words, descriptions[entry.id], categories[entry.category]));
  const shown = category ? found.filter((entry) => entry.category === category) : found;
  const counts = (id: McpCatalogCategory) => found.filter((entry) => entry.category === id).length;
  const chip = "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-foreground/10 transition-colors hover:bg-foreground/5 aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:ring-foreground";

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("Search connectors")}
          aria-label={t("Search connectors")}
          className="pl-9"
          autoFocus={autoFocus}
        />
      </div>
      <div role="group" aria-label={t("Category")} className="flex flex-wrap gap-2">
        <button type="button" className={chip} aria-pressed={category === null} onClick={() => setCategory(null)}>
          {t("All")} <span className="opacity-60">{found.length}</span>
        </button>
        {categoryOrder.map((id) => (
          <button key={id} type="button" className={chip} aria-pressed={category === id} onClick={() => setCategory(category === id ? null : id)}>
            {categories[id]} <span className="opacity-60">{counts(id)}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">{t("{count, plural, one {# connector} other {# connectors}}", { count: shown.length })}</p>
      {shown.length === 0 ? (
        <Empty
          size="sm"
          icon={<SearchXIcon className="size-6 text-muted-foreground" />}
          title={query.trim() ? t("No connectors match “{query}”.", { query: query.trim() }) : t("No connectors in this category.")}
          description={empty}
        />
      ) : (
        <ul className={cn("grid gap-3 sm:grid-cols-2", listClassName)}>
          {shown.map((entry) => (
            <li key={entry.id} className={cn("flex flex-col gap-3 rounded-xl border border-foreground/10 bg-surface-raised p-4", cardClassName)}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-foreground/10">
                  <ConnectorLogo id={entry.id} className="size-6" />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate font-semibold">{entry.name}</h4>
                  <p className="text-xs text-muted-foreground">{categories[entry.category]}</p>
                </div>
              </div>
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{descriptions[entry.id]}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-xs">{renderStatus?.(entry)}</div>
                {renderAction(entry)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
