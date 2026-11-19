import { afterEach, expect, test, vi } from "vitest";
import { fetchSafePublicHttpUrl, assertSafePublicHttpUrl } from "@/lib/network-security";
import {
  fetchPageMarkdown,
  fetchPageText,
  MAX_PAGE_RESPONSE_BYTES,
  readBoundedResponseText,
} from "./fetch-page";

vi.mock("@/lib/network-security", () => ({
  assertSafePublicHttpUrl: vi.fn(async (url: string) => new URL(url)),
  fetchSafePublicHttpUrl: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.mocked(assertSafePublicHttpUrl).mockImplementation(async (url) => new URL(url));
  vi.unstubAllGlobals();
});

function streamed(chunks: Uint8Array[], headers?: HeadersInit) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  });
  return { response: new Response(body, { headers }), cancel };
}

test("reads text within the limit and preserves UTF-8 across chunk boundaries", async () => {
  const bytes = new TextEncoder().encode("日本語");
  const { response } = streamed([bytes.slice(0, 2), bytes.slice(2, 5), bytes.slice(5)]);
  expect(await readBoundedResponseText(response)).toBe("日本語");
});

test("rejects an oversized Content-Length before reading and cancels the body", async () => {
  const { response, cancel } = streamed([new Uint8Array(1)], {
    "content-length": String(MAX_PAGE_RESPONSE_BYTES + 1),
  });
  await expect(readBoundedResponseText(response)).rejects.toThrow("too large");
  expect(cancel).toHaveBeenCalledOnce();
});

test.each([undefined, "1"])("bounds chunked bodies even with Content-Length %s", async (length) => {
  const { response, cancel } = streamed(
    [new Uint8Array(MAX_PAGE_RESPONSE_BYTES), new Uint8Array(1), new Uint8Array(1)],
    length ? { "content-length": length } : undefined,
  );
  await expect(readBoundedResponseText(response)).rejects.toThrow("too large");
  expect(cancel).toHaveBeenCalledOnce();
});

test("accepts exactly the byte limit", async () => {
  const { response } = streamed([new Uint8Array(MAX_PAGE_RESPONSE_BYTES)]);
  expect((await readBoundedResponseText(response)).length).toBe(MAX_PAGE_RESPONSE_BYTES);
});

test("direct page retrieval enforces the body limit", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    streamed([new Uint8Array(MAX_PAGE_RESPONSE_BYTES + 1)], { "content-type": "text/plain" })
      .response,
  );
  await expect(
    fetchPageText("https://probe.example/", { allowReaderFallback: false }),
  ).rejects.toThrow("too large");
});

test("fetchPageMarkdown reads page markdown through markdown.new", async () => {
  const fetch = vi.fn(
    async () => new Response(`# Title\n\n${"Readable body text. ".repeat(10)}`, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  const page = await fetchPageMarkdown("https://probe.example/");
  expect(fetch).toHaveBeenCalledWith(
    "https://markdown.new/https://probe.example/",
    expect.anything(),
  );
  expect(page.content).toContain("Readable body text.");
});

test("fetchPageMarkdown rejects non-OK responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  await expect(fetchPageMarkdown("https://probe.example/")).rejects.toThrow("500");
});

test("reader fallback enforces the same body limit", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(new Response(null, { status: 403 }));
  const { response, cancel } = streamed([
    new Uint8Array(MAX_PAGE_RESPONSE_BYTES + 1),
    new Uint8Array(1),
  ]);
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  await expect(fetchPageText("https://probe.example/")).rejects.toThrow("too large");
  expect(fetch).toHaveBeenCalledWith("https://r.jina.ai/https://probe.example/", expect.anything());
  expect(cancel).toHaveBeenCalledOnce();
});

test("does not mistake a long article that mentions blocking for a block page", async () => {
  const article = `${"The forbidden city and the phrase access denied appear in this long article. ".repeat(40)}`;
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    new Response(
      `<html><head><title>History</title></head><body><article>${article}</article></body></html>`,
      {
        headers: { "content-type": "text/html" },
      },
    ),
  );
  const page = await fetchPageText("https://probe.example/", { allowReaderFallback: false });
  expect(page.content).toContain("forbidden city");
});

test("still rejects a short block page", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    new Response(
      `<html><head><title>Just a moment...</title></head><body><main>${"Checking your browser before accessing the site. ".repeat(4)}</main></body></html>`,
      { headers: { "content-type": "text/html" } },
    ),
  );
  await expect(
    fetchPageText("https://probe.example/", { allowReaderFallback: false }),
  ).rejects.toThrow();
});

/** Direct fetch that never answers and rejects the way node:http does when its signal aborts. */
function hangUntilAborted(_url: string, init?: { signal?: AbortSignal }) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
}

const readerPage = `Title: Reader title\n\nMarkdown Content:\n${"Readable reader text. ".repeat(10)}`;

test("a direct-fetch timeout falls back to the reader", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(hangUntilAborted);
  const fetch = vi.fn(async () => new Response(readerPage, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const page = await fetchPageText("https://probe.example/", { timeoutMs: 20 });
  expect(fetch).toHaveBeenCalledWith("https://r.jina.ai/https://probe.example/", expect.anything());
  expect(page.source).toBe("reader");
  expect(page.content).toContain("Readable reader text.");
});

test("a direct-fetch timeout without the reader reports a timeout", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(hangUntilAborted);
  await expect(
    fetchPageText("https://probe.example/", { timeoutMs: 20, allowReaderFallback: false }),
  ).rejects.toThrow("timed out");
});

test("a caller cancel skips the reader", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(hangUntilAborted);
  const fetch = vi.fn(async () => new Response(readerPage, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const pending = fetchPageText("https://probe.example/", { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

// "日本語" in Shift_JIS and EUC-JP.
const SJIS_NIHONGO = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea];
const EUCJP_NIHONGO = [0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec];

function encodedHtml(head: string, body: number[]) {
  const ascii = (value: string) => [...new TextEncoder().encode(value)];
  return new Uint8Array([
    ...ascii(`<html><head>${head}<title>`),
    ...body,
    ...ascii("</title></head><body><article>"),
    ...Array.from({ length: 30 }, () => body).flat(),
    ...ascii("</article></body></html>"),
  ]);
}

test("decodes text in the charset from Content-Type", async () => {
  const { response } = streamed([new Uint8Array(SJIS_NIHONGO)], {
    "content-type": "text/plain; charset=Shift_JIS",
  });
  expect(await readBoundedResponseText(response)).toBe("日本語");
});

test("decodes HTML in the charset its meta tag declares", async () => {
  const { response } = streamed(
    [
      encodedHtml(
        '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">',
        EUCJP_NIHONGO,
      ),
    ],
    { "content-type": "text/html" },
  );
  expect(await readBoundedResponseText(response)).toContain("<title>日本語</title>");
});

test("falls back to UTF-8 for an unknown charset", async () => {
  const { response } = streamed([new TextEncoder().encode("日本語")], {
    "content-type": "text/plain; charset=not-a-charset",
  });
  expect(await readBoundedResponseText(response)).toBe("日本語");
});

test("a Shift_JIS page is read directly without garbling", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    new Response(encodedHtml('<meta charset="Shift_JIS">', SJIS_NIHONGO), {
      headers: { "content-type": "text/html" },
    }),
  );
  const page = await fetchPageText("https://probe.example/", { allowReaderFallback: false });
  expect(page.title).toBe("日本語");
  expect(page.content).toBe("日本語".repeat(30));
});
