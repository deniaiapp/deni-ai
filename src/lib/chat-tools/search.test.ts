import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSearchTool } from "./search";
import { consumeUsage, settleUsage } from "@/lib/usage";
import { fetchPageMarkdown, fetchPageText } from "./fetch-page";

vi.mock("@/env", () => ({ env: { EXA_API_KEY: "test" } }));
vi.mock("./fetch-page", () => ({ fetchPageMarkdown: vi.fn(), fetchPageText: vi.fn() }));
vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>("@/lib/usage");
  return {
    ...actual,
    consumeUsage: vi.fn(),
    settleUsage: vi.fn(),
    recordObservedUsage: vi.fn(async () => {}),
  };
});
// Imports used by usage's constants must remain safe without local env/database.
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

const period = {
  unit: "tokens" as const,
  start: new Date("2026-06-01"),
  end: new Date("2026-07-01"),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeUsage).mockResolvedValue({
    reservationId: "reservation",
    tier: "pro",
    unit: "tokens",
    limit: 300_000_000,
    remaining: 100_000,
    maxModeAmount: 0,
    usedMaxMode: false,
    period,
  });
  vi.mocked(settleUsage).mockResolvedValue({ amount: 0, maxModeAmount: 0 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 429 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("a failed search settles its own reservation to zero", async () => {
  const search = createSearchTool({ userId: "user", isAnonymous: false });
  expect(
    await search.execute!({ query: "example" }, { toolCallId: "call", messages: [], context: {} }),
  ).toEqual([]);
  const reservationId = vi.mocked(consumeUsage).mock.calls[0][0].reservationId;
  expect(settleUsage).toHaveBeenCalledWith({ userId: "user", reservationId, amount: 0 });
});

test("unlimited search usage still closes the reservation", async () => {
  vi.mocked(consumeUsage).mockResolvedValue({
    reservationId: "reservation",
    tier: "max",
    unit: "tokens",
    limit: null,
    remaining: null,
    maxModeAmount: 0,
    usedMaxMode: false,
    period,
  });
  const search = createSearchTool({ userId: "user", isAnonymous: false });
  expect(
    await search.execute!({ query: "example" }, { toolCallId: "call", messages: [], context: {} }),
  ).toEqual([]);
  expect(settleUsage).toHaveBeenCalledOnce();
});

test("a markdown.new timeout still falls back to a direct page fetch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        results: [{ title: "Page", url: "https://probe.example/", highlights: [] }],
      }),
    ),
  );
  vi.mocked(fetchPageMarkdown).mockRejectedValue(
    new DOMException("The operation was aborted.", "AbortError"),
  );
  vi.mocked(fetchPageText).mockResolvedValue({
    url: "https://probe.example/",
    title: "Page",
    content: "Direct page text",
    truncated: false,
    contentLength: 16,
    source: "direct",
  });
  const search = createSearchTool({ userId: "user", isAnonymous: false });
  const results = await search.execute!(
    { query: "example" },
    { toolCallId: "call", messages: [], context: {} },
  );
  expect(fetchPageText).toHaveBeenCalledWith(
    "https://probe.example/",
    expect.objectContaining({ allowReaderFallback: false }),
  );
  expect(results).toEqual([expect.objectContaining({ content: "Direct page text" })]);
});

test("parallel searches take turns on usage writes", async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(consumeUsage).mockImplementation(async ({ reservationId }) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return {
      reservationId,
      tier: "pro",
      unit: "tokens",
      limit: 300_000_000,
      remaining: 100_000,
      maxModeAmount: 0,
      usedMaxMode: false,
      period,
    };
  });
  const search = createSearchTool({ userId: "user", isAnonymous: false });
  const options = { toolCallId: "call", messages: [], context: {} };
  await Promise.all([
    search.execute!({ query: "one" }, options),
    search.execute!({ query: "two" }, options),
    search.execute!({ query: "three" }, options),
  ]);
  expect(consumeUsage).toHaveBeenCalledTimes(3);
  expect(peak).toBe(1);
});
