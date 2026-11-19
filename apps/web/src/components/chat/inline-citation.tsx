import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { createContext, type ComponentProps, type ReactNode, useContext } from "react";
import { useExtracted } from "use-intl";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@deniai/ui/components/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@deniai/ui/components/popover";
import { type CitationSource, parseCitationIds } from "@/lib/chat-citations";
import { getSafeDisplayUrl, toSafeHref } from "@/lib/safe-href";

const EMPTY_SOURCES: ReadonlyMap<number, CitationSource> = new Map();

const CitationSourcesContext = createContext<ReadonlyMap<number, CitationSource>>(EMPTY_SOURCES);

/** The search results that `[cite:id]` markers inside this subtree refer to. */
export function CitationSourcesProvider({
  sources,
  children,
}: {
  sources: ReadonlyMap<number, CitationSource>;
  children: ReactNode;
}) {
  return (
    <CitationSourcesContext.Provider value={sources}>{children}</CitationSourcesContext.Provider>
  );
}

const pillClassName =
  "not-prose mx-0.5 inline-flex max-w-[min(14rem,70vw)] cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-0.5 align-[0.1em] text-xs leading-4 font-normal text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** Search snippets are page markdown; show them as one line of plain text. */
const snippetText = (value: string) =>
  value
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sourceLabel = (source: CitationSource) =>
  source.title.trim() || getSafeDisplayUrl(source.url)?.hostname || source.url;

function CitationSourceDetails({ source }: { source: CitationSource }) {
  const hostname = getSafeDisplayUrl(source.url)?.hostname;
  return (
    <a
      className="group/source flex flex-col gap-1 rounded-2xl p-2 no-underline hover:bg-muted"
      href={toSafeHref(source.url)}
      rel="noreferrer"
      target="_blank"
    >
      {hostname ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GlobeIcon className="size-3 shrink-0" />
          <span className="truncate">{hostname}</span>
          <ExternalLinkIcon className="ml-auto size-3 shrink-0 opacity-0 group-hover/source:opacity-100" />
        </span>
      ) : null}
      <span className="line-clamp-2 font-medium text-foreground">{sourceLabel(source)}</span>
      {source.description ? (
        <span className="line-clamp-3 text-xs text-muted-foreground">
          {snippetText(source.description)}
        </span>
      ) : null}
    </a>
  );
}

function InlineCitation({ sources }: { sources: CitationSource[] }) {
  const t = useExtracted();
  const [first, ...rest] = sources;
  const label = (
    <>
      <span className="truncate">{sourceLabel(first)}</span>
      {rest.length > 0 ? (
        <span className="shrink-0 tabular-nums">
          {t("+{count}", { count: String(rest.length) })}
        </span>
      ) : null}
    </>
  );

  if (rest.length === 0) {
    return (
      <HoverCard>
        <HoverCardTrigger
          className={pillClassName}
          href={toSafeHref(first.url)}
          rel="noreferrer"
          target="_blank"
        >
          {label}
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-80 p-2">
          <CitationSourceDetails source={first} />
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("{count} sources", { count: String(sources.length) })}
        className={pillClassName}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-96 w-80 gap-1 overflow-y-auto p-2">
        {sources.map((source) => (
          <CitationSourceDetails key={source.id} source={source} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

type StreamdownSupProps = ComponentProps<"sup"> & { "data-citation"?: string };

/** `sup` override: citation markers from `citationRehypePlugin` become source buttons. */
export function StreamdownSup({
  "data-citation": citation,
  className,
  ...props
}: StreamdownSupProps) {
  const sources = useContext(CitationSourcesContext);

  if (citation === undefined) {
    return <sup className={className} {...props} />;
  }

  const cited = parseCitationIds(citation)
    .map((id) => sources.get(id))
    .filter((source): source is CitationSource => source !== undefined);
  // An id with no search result in this message is dropped rather than shown raw.
  if (cited.length === 0) return null;

  return <InlineCitation sources={cited} />;
}
