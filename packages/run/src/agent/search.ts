const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_MAX_CHARACTERS = 1500;
const REQUEST_TIMEOUT_MS = 30_000;

export type WebSearchInput = {
  query: string;
  numResults?: number;
  type?: "auto" | "fast" | "deep";
  category?: "company" | "publication" | "news" | "personal site" | "financial report" | "people";
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeText?: boolean;
};

export type WebSearchResult = {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  text?: string;
};

export type WebSearchOutput = {
  query: string;
  results: WebSearchResult[];
};

type ExaResult = {
  title?: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  highlights?: string[];
  text?: string;
};

type ExaResponse = {
  requestId?: string;
  results?: ExaResult[];
  error?: string;
  tag?: string;
};

export function hasExaApiKey(): boolean {
  return Boolean(process.env.EXA_API_KEY?.trim());
}

export async function webSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not configured; web search is unavailable");
  }
  const query = input.query.trim();
  if (!query) throw new Error("query is required");

  const numResults = Math.min(Math.max(input.numResults ?? 5, 1), 10);
  const body: Record<string, unknown> = {
    query,
    type: input.type ?? "auto",
    numResults,
    contents: {
      highlights: { maxCharacters: 600 },
      ...(input.includeText ? { text: { maxCharacters: DEFAULT_MAX_CHARACTERS } } : {}),
    },
  };
  if (input.category) body.category = input.category;
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  if (input.startPublishedDate) body.startPublishedDate = input.startPublishedDate;
  if (input.endPublishedDate) body.endPublishedDate = input.endPublishedDate;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Web search request failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => ({}))) as ExaResponse;
  if (!response.ok) {
    const detail = payload.error ?? response.statusText ?? "unknown error";
    throw new Error(`Web search failed (${response.status}): ${detail}`);
  }

  const results: WebSearchResult[] = (payload.results ?? []).map((item) => ({
    title: item.title?.trim() || item.url,
    url: item.url,
    ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    ...(item.author ? { author: item.author } : {}),
    ...(item.highlights?.length ? { highlights: item.highlights } : {}),
    ...(item.text ? { text: item.text } : {}),
  }));

  return { query, results };
}
