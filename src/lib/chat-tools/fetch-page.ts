import { load } from "cheerio";
import { assertSafePublicHttpUrl, fetchSafePublicHttpUrl } from "@/lib/network-security";
import { createAbortError, fetchWithAbortHandling } from "./helpers";

export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 12_000;
export const DEFAULT_BROWSE_MAX_CHARS = 20_000;
export const MIN_BROWSE_MAX_CHARS = 1_000;
export const MAX_BROWSE_MAX_CHARS = 50_000;
/** Cap raw HTML before parsing to avoid pathological pages. */
const MAX_RAW_HTML_CHARS = 2_000_000;
export const MAX_PAGE_RESPONSE_BYTES = 2_000_000;

/** `charset` parameter of a Content-Type header, e.g. `text/html; charset=Shift_JIS`. */
const CONTENT_TYPE_CHARSET = /;\s*charset\s*=\s*["']?([^\s;"']+)/i;
/** `<meta charset="...">` or `<meta http-equiv="Content-Type" content="...; charset=...">`. */
const META_CHARSET = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([\w.:-]+)/i;
const XML_DECLARATION_ENCODING = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([\w.:-]+)/i;
/** How much of an HTML or XML page is searched for a declared encoding. */
const CHARSET_SNIFF_BYTES = 4096;

function decoderFor(label: string | undefined) {
  if (!label) return null;
  try {
    return new TextDecoder(label);
  } catch {
    // Unknown or unsupported label.
    return null;
  }
}

/**
 * Pick the page's text encoding the way browsers do: byte-order mark, then the
 * Content-Type charset, then (for HTML and XML) an in-document declaration,
 * then UTF-8. Legacy encodings such as Shift_JIS and EUC-JP are still common
 * on Japanese sites and decode to replacement characters as UTF-8.
 */
function pageTextDecoder(bytes: Uint8Array, contentType: string) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder();
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be");

  const declared = decoderFor(CONTENT_TYPE_CHARSET.exec(contentType)?.[1]);
  if (declared) return declared;

  if (!contentType || /html|xml/i.test(contentType)) {
    // The declaration itself is ASCII, so any single-byte reading finds it.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, CHARSET_SNIFF_BYTES));
    const label = (XML_DECLARATION_ENCODING.exec(head) ?? META_CHARSET.exec(head))?.[1];
    // A declaration readable as ASCII cannot be UTF-16, so browsers treat that one as UTF-8.
    const sniffed = label && /^utf-?16/i.test(label) ? null : decoderFor(label);
    if (sniffed) return sniffed;
  }

  return new TextDecoder();
}

/**
 * Limit response bytes, including chunked or compressed responses, then decode
 * them in the page's charset.
 */
export async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_PAGE_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Page response is too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PAGE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Page response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pageTextDecoder(bytes, response.headers.get("content-type") ?? "").decode(bytes);
}
const MAX_REDIRECTS = 5;
const READER_TIMEOUT_MS = 20_000;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Browser-like headers for direct site fetches. */
const BROWSER_HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": BROWSER_USER_AGENT,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PageFetchSource = "direct" | "reader";

export type FetchedPageText = {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  contentLength: number;
  /** How the page text was obtained. */
  source: PageFetchSource;
};

function clampMaxChars(maxChars?: number) {
  return Math.min(
    Math.max(maxChars ?? DEFAULT_BROWSE_MAX_CHARS, MIN_BROWSE_MAX_CHARS),
    MAX_BROWSE_MAX_CHARS,
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function statusErrorMessage(status: number) {
  switch (status) {
    case 401:
      return "Page requires authentication (401).";
    case 403:
      return "Page blocked the request (403). The site may reject automated access.";
    case 404:
      return "Page not found (404).";
    case 429:
      return "Page rate-limited the request (429).";
    default:
      return `Failed to fetch page (${status}).`;
  }
}

const BLOCK_PAGE_MAX_CHARS = 1500;

function looksLikeBlockedOrEmptyPage(title: string, content: string) {
  const normalizedTitle = title.toLowerCase();
  const normalizedContent = content.toLowerCase();
  const blockedMarkers = [
    "access denied",
    "just a moment",
    "attention required",
    "cf-browser-verification",
    "enable javascript and cookies",
    "checking your browser",
    "verify you are human",
    "request blocked",
    "403 forbidden",
  ];

  if (!content || content.length < 80) {
    return true;
  }

  // Block pages are short; matching the body of a long page would reject real
  // articles that merely mention "access denied" or "403 forbidden".
  const scanBody = content.length < BLOCK_PAGE_MAX_CHARS;
  return blockedMarkers.some(
    (marker) =>
      normalizedTitle.includes(marker) || (scanBody && normalizedContent.includes(marker)),
  );
}

function extractReadableText(html: string, maxChars: number, fallbackTitle: string) {
  const $ = load(html.slice(0, MAX_RAW_HTML_CHARS));
  $("script, style, noscript, iframe, svg, canvas, template").remove();
  $("nav, footer, header, aside").remove();

  const title =
    $("title").first().text().replace(/\s+/g, " ").trim() ||
    $('meta[property="og:title"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    fallbackTitle;

  const mainText = (
    $("article").text() ||
    $("main").text() ||
    $('[role="main"]').text() ||
    $("body").text()
  )
    .replace(/\s+/g, " ")
    .trim();

  const metaDescription =
    $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    $('meta[property="og:description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    "";

  const bodyText =
    mainText.length >= 80 ? mainText : [metaDescription, mainText].filter(Boolean).join(" ").trim();

  const contentLength = bodyText.length;
  const truncated = contentLength > maxChars;

  return {
    title,
    content: bodyText.slice(0, maxChars),
    truncated,
    contentLength,
  };
}

function parseJinaReaderText(
  raw: string,
  maxChars: number,
  fallbackTitle: string,
): { title: string; content: string; truncated: boolean; contentLength: number } {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let title = fallbackTitle;
  let contentStart = 0;

  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("Title:")) {
      title = line.slice("Title:".length).trim() || title;
      continue;
    }
    if (line.startsWith("Markdown Content:")) {
      contentStart = i + 1;
      break;
    }
  }

  const content = lines
    .slice(contentStart)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const contentLength = content.length;
  const truncated = contentLength > maxChars;

  return {
    title,
    content: content.slice(0, maxChars),
    truncated,
    contentLength,
  };
}

async function withTimeoutSignal<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort);

  try {
    throwIfAborted(parent);
    return await run(controller.signal);
  } finally {
    clearTimeout(timeoutId);
    parent?.removeEventListener("abort", onAbort);
  }
}

/** Follow redirects manually and re-validate each hop against private networks. */
async function fetchWithSafeRedirects(
  url: string,
  signal: AbortSignal,
): Promise<{ raw: string; contentType: string; finalUrl: string; finalHostname: string }> {
  let current = await assertSafePublicHttpUrl(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchSafePublicHttpUrl(current.toString(), {
      headers: BROWSER_HEADERS,
      signal,
    });
    if (!response.ok) {
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();

        if (!location) {
          throw new Error(`Redirect without Location header (${response.status}).`);
        }

        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("Invalid redirect Location header.");
        }

        current = await assertSafePublicHttpUrl(next.toString());
        continue;
      }

      await response.body?.cancel();
      throw new Error(statusErrorMessage(response.status));
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding !== "identity") {
      await response.body?.cancel();
      throw new Error("Unsupported page content encoding.");
    }
    const raw = await readBoundedResponseText(response);
    return {
      raw,
      contentType,
      finalUrl: current.toString(),
      finalHostname: current.hostname,
    };
  }

  throw new Error("Too many redirects while opening the page.");
}

async function parseSuccessfulResponse(
  raw: string,
  contentType: string,
  finalUrl: string,
  finalHostname: string,
  maxChars: number,
  source: PageFetchSource,
): Promise<FetchedPageText> {
  const isTextLike =
    contentType.length === 0 ||
    contentType.includes("text/") ||
    contentType.includes("html") ||
    contentType.includes("xml") ||
    contentType.includes("json") ||
    contentType.includes("javascript") ||
    contentType.includes("markdown");

  if (!isTextLike) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  if (
    contentType.includes("text/plain") ||
    contentType.includes("json") ||
    contentType.includes("markdown")
  ) {
    const normalized = contentType.includes("markdown")
      ? raw.replace(/\n{3,}/g, "\n\n").trim()
      : raw.replace(/\s+/g, " ").trim();

    if (looksLikeBlockedOrEmptyPage(finalHostname, normalized)) {
      throw new Error("Page returned no useful text content.");
    }

    return {
      url: finalUrl,
      title: finalHostname,
      content: normalized.slice(0, maxChars),
      truncated: normalized.length > maxChars,
      contentLength: normalized.length,
      source,
    };
  }

  const extracted = extractReadableText(raw, maxChars, finalHostname);
  if (looksLikeBlockedOrEmptyPage(extracted.title, extracted.content)) {
    throw new Error("Page returned a challenge or empty body.");
  }

  return {
    url: finalUrl,
    title: extracted.title || finalHostname,
    content: extracted.content,
    truncated: extracted.truncated,
    contentLength: extracted.contentLength,
    source,
  };
}

async function fetchDirect(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<FetchedPageText> {
  const { raw, contentType, finalUrl, finalHostname } = await fetchWithSafeRedirects(url, signal);
  return parseSuccessfulResponse(raw, contentType, finalUrl, finalHostname, maxChars, "direct");
}

async function fetchViaReader(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<FetchedPageText> {
  const parsed = await assertSafePublicHttpUrl(url);
  const requestUrl = parsed.toString();
  const readerUrl = `https://r.jina.ai/${requestUrl}`;

  // Do NOT send a browser Chrome UA here. Cloudflare in front of r.jina.ai
  // challenges spoofed browser clients (403 "Just a moment..."), while plain
  // non-browser clients succeed.
  const response = await fetchWithAbortHandling(readerUrl, {
    headers: {
      Accept: "text/plain,text/markdown,*/*;q=0.8",
      "User-Agent": "DeniAI-Reader/1.0",
      "X-Return-Format": "markdown",
    },
    signal,
    redirect: "error",
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Reader fallback failed (${response.status}).`);
  }

  const raw = await readBoundedResponseText(response);
  if (looksLikeBlockedOrEmptyPage("reader", raw) || raw.includes("Just a moment...")) {
    throw new Error("Reader fallback returned a challenge page.");
  }

  const extracted = parseJinaReaderText(raw, maxChars, parsed.hostname);
  if (!extracted.content || extracted.contentLength < 40) {
    throw new Error("Reader fallback returned no readable content.");
  }

  return {
    url: requestUrl,
    title: extracted.title,
    content: extracted.content,
    truncated: extracted.truncated,
    contentLength: extracted.contentLength,
    source: "reader",
  };
}

/**
 * Fetch a public HTTP(S) page as markdown through markdown.new.
 * Used for search result summarization; callers should fall back to fetchPageText on failure.
 */
export async function fetchPageMarkdown(
  url: string,
  options?: { maxChars?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<FetchedPageText> {
  const maxChars = clampMaxChars(options?.maxChars);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PAGE_FETCH_TIMEOUT_MS;
  const parsed = await assertSafePublicHttpUrl(url);
  const requestUrl = parsed.toString();

  return withTimeoutSignal(timeoutMs, options?.signal, async (signal) => {
    const response = await fetchWithAbortHandling(`https://markdown.new/${requestUrl}`, {
      headers: {
        Accept: "text/markdown,text/plain,*/*;q=0.8",
        "User-Agent": "DeniAI-Reader/1.0",
      },
      signal,
      redirect: "error",
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`markdown.new failed (${response.status}).`);
    }

    const content = (await readBoundedResponseText(response)).replace(/\n{3,}/g, "\n\n").trim();
    if (looksLikeBlockedOrEmptyPage("markdown.new", content)) {
      throw new Error("markdown.new returned no readable content.");
    }

    return {
      url: requestUrl,
      title: parsed.hostname,
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
      contentLength: content.length,
      source: "reader",
    };
  });
}

/**
 * Fetch a public HTTP(S) page and return cleaned text content for agent tools.
 * Order: direct fetch, then r.jina.ai reader fallback.
 * Blocks private/local network targets and re-validates every redirect hop.
 */
export async function fetchPageText(
  url: string,
  options?: {
    maxChars?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    /**
     * When false, only attempt a direct fetch (used by search summarization for speed).
     * Browse enables reader fallback by default.
     */
    allowReaderFallback?: boolean;
  },
): Promise<FetchedPageText> {
  const maxChars = clampMaxChars(options?.maxChars);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PAGE_FETCH_TIMEOUT_MS;
  const allowReaderFallback = options?.allowReaderFallback !== false;
  const requestUrl = (await assertSafePublicHttpUrl(url)).toString();

  let directError: Error | null = null;

  try {
    return await withTimeoutSignal(timeoutMs, options?.signal, (signal) =>
      fetchDirect(requestUrl, maxChars, signal),
    );
  } catch (error) {
    // Only the caller's cancel stops here. The direct fetch's own timeout aborts
    // the same way, and a slow or tarpitting site is what the reader is for.
    if (options?.signal?.aborted) {
      throw error;
    }
    directError = isAbortError(error)
      ? new Error("Page fetch timed out.")
      : error instanceof Error
        ? error
        : new Error("Direct fetch failed");
    if (!allowReaderFallback) {
      throw directError;
    }
  }

  try {
    return await withTimeoutSignal(
      Math.max(timeoutMs, READER_TIMEOUT_MS),
      options?.signal,
      (signal) => fetchViaReader(requestUrl, maxChars, signal),
    );
  } catch (readerError) {
    if (options?.signal?.aborted) {
      throw readerError;
    }
    const readerMessage = isAbortError(readerError)
      ? "Reader fallback timed out."
      : readerError instanceof Error
        ? readerError.message
        : "Reader fallback failed";
    throw new Error(directError ? `${directError.message} ${readerMessage}` : readerMessage);
  }
}
