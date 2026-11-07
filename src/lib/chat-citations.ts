/**
 * Inline citations: the model writes `[cite:3]` or `[cite:3,5]` after a sentence,
 * where each number is the `id` of a search result from the same response.
 */
export const CITATION_MARKER_PATTERN = /\[cite:\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g;

export type CitationSource = {
  id: number;
  title: string;
  url: string;
  description?: string;
};

type MessagePartLike = { type: string; state?: string; output?: unknown };

const isCitationSource = (value: unknown): value is CitationSource => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "number" && typeof item.url === "string" && typeof item.title === "string"
  );
};

/** Splits the ids of one marker body such as `3, 5`, dropping duplicates. */
export function parseCitationIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

/** The search results of one assistant message, by citation id. */
export function collectCitationSources(
  parts: readonly MessagePartLike[] | undefined,
): Map<number, CitationSource> {
  const sources = new Map<number, CitationSource>();
  for (const part of parts ?? []) {
    if (part.type !== "tool-search" || part.state !== "output-available") continue;
    if (!Array.isArray(part.output)) continue;
    for (const result of part.output) {
      if (isCitationSource(result) && !sources.has(result.id)) {
        sources.set(result.id, {
          id: result.id,
          title: result.title,
          url: result.url,
          description: result.description,
        });
      }
    }
  }
  return sources;
}

/**
 * Plain-text form of the markers for copying and exports: known sources become
 * markdown links, unknown ids are dropped.
 */
export function replaceCitationMarkers(
  text: string,
  sources: ReadonlyMap<number, CitationSource>,
  format: "markdown" | "none" = "markdown",
): string {
  return text.replace(MARKER_WITH_LEADING_SPACE, (_marker, body: string) => {
    if (format === "none") return "";
    const links = parseCitationIds(body)
      .map((id) => sources.get(id))
      .filter((source): source is CitationSource => source !== undefined)
      .map(
        (source) =>
          `[${escapeLinkText(source.title || source.url)}](${linkDestination(source.url)})`,
      );
    return links.length > 0 ? ` (${links.join(", ")})` : "";
  });
}

const MARKER_WITH_LEADING_SPACE = new RegExp(`[ \\t]*${CITATION_MARKER_PATTERN.source}`, "g");

const escapeLinkText = (value: string) => value.replace(/[[\]\\]/g, "\\$&");

const linkDestination = (url: string) =>
  /[\s()<>]/.test(url) ? `<${url.replace(/[\s<>]/g, (char) => encodeURIComponent(char))}>` : url;
