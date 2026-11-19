import { useState } from "react";
import { ArrowLeft, Check, Search, SearchX } from "lucide-react";
import { useExtracted } from "use-intl";
import { mcpCatalog, type McpCatalogCategory, type McpCatalogEntry } from "@deniai/run/mcp/catalog";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { Input } from "@deniai/ui/components/input";
import { Link } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { RunPage } from "../run-page";
import {
  CONNECTOR_CATEGORY_ORDER,
  useConnectorCategories,
  useConnectorDescriptions,
} from "./connector-copy";
import { ConnectorLogoTile } from "./connector-logos";
import { useMcpState } from "./use-connectors";

/** Every typed word must appear in the name, id, keywords, description, or category. */
function matches(entry: McpCatalogEntry, words: string[], description: string, category: string) {
  const text = [entry.name, entry.id, ...(entry.keywords ?? []), description, category]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** `/run/connectors`: every one-click connector as a searchable store of cards. */
export function ConnectorGalleryPage() {
  const t = useExtracted();
  const descriptions = useConnectorDescriptions();
  const categories = useConnectorCategories();
  const mcp = useMcpState();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<McpCatalogCategory | null>(null);
  const installed = new Set(mcp.data?.connections.map((connection) => connection.catalogId));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = mcpCatalog.filter((entry) =>
    matches(entry, words, descriptions[entry.id], categories[entry.category]),
  );
  const shown = category ? found.filter((entry) => entry.category === category) : found;
  const count = (id: McpCatalogCategory) => found.filter((entry) => entry.category === id).length;

  return (
    <RunPage
      title={t("Connectors")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/run/settings" />}
          nativeButton={false}
        >
          <ArrowLeft className="size-4" />
          {t("Run settings")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("Search connectors")}
            aria-label={t("Search connectors")}
            className="pl-9"
          />
        </div>
        <div role="group" aria-label={t("Category")} className="flex flex-wrap gap-2">
          {[null, ...CONNECTOR_CATEGORY_ORDER].map((id) => (
            <Button
              key={id ?? "all"}
              size="xs"
              variant={category === id ? "default" : "outline"}
              className="rounded-full"
              aria-pressed={category === id}
              onClick={() => setCategory(category === id ? null : id)}
            >
              {id ? categories[id] : t("All")}
              <span className="tabular-nums opacity-60">{id ? count(id) : found.length}</span>
            </Button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status">
        {t("{count, plural, one {# connector} other {# connectors}}", { count: shown.length })}
      </p>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <SearchX className="size-6" aria-hidden />
          {query.trim()
            ? t("No connectors match “{query}”.", { query: query.trim() })
            : t("No connectors in this category.")}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/run/connectors/${entry.id}`}
                className={cn(
                  "flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors",
                  "hover:border-foreground/20 hover:bg-accent/40",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <div className="flex items-center gap-3">
                  <ConnectorLogoTile id={entry.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{entry.name}</p>
                    <p className="text-xs text-muted-foreground">{categories[entry.category]}</p>
                  </div>
                  {installed.has(entry.id) && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Check className="size-3" />
                      {t("Installed")}
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {descriptions[entry.id]}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RunPage>
  );
}
