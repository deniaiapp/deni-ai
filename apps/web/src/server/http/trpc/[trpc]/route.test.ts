import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ mutate: vi.fn(() => ({ ok: true })) }));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_BETTER_AUTH_URL: "https://app.example" } }));
vi.mock("@/server/api/trpc", () => ({
  createContext: async () => ({ session: { userId: "victim" } }),
}));
vi.mock("@/server/api/root", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return {
    appRouter: t.router({
      clearAll: t.procedure.mutation(() => state.mutate()),
      echo: t.procedure.input((value: unknown) => value).mutation(() => state.mutate()),
      get: t.procedure.query(() => ({ ok: true })),
      migration: t.router({
        import: t.procedure.input((value: unknown) => value).mutation(() => state.mutate()),
      }),
      chat: t.router({
        saveComparison: t.procedure.input((value: unknown) => value).mutation(() => state.mutate()),
        saveComparisonSession: t.procedure
          .input((value: unknown) => value)
          .mutation(() => state.mutate()),
      }),
    }),
  };
});
const { POST, GET } = await import("./route");
const { COMPARISON_SIDE_BODY_LIMIT, TRPC_DEFAULT_BODY_LIMIT } = await import("@/lib/trpc/limits");
const { CHAT_BODY_LIMIT } = await import("@/lib/request-body");
beforeEach(() => state.mutate.mockClear());

test("a cross-site form cannot execute a mutation without input", async () => {
  const response = await POST(
    new Request("https://app.example/api/trpc/clearAll", {
      method: "POST",
      headers: {
        origin: "https://attacker.app.example",
        cookie: "session=victim",
        "sec-fetch-site": "same-site",
      },
      body: new FormData(),
    }),
  );
  expect(response.status).toBe(403);
  expect(state.mutate).not.toHaveBeenCalled();
});

test("non-JSON mutations are rejected even without an Origin header", async () => {
  const response = await POST(
    new Request("https://app.example/api/trpc/clearAll", { method: "POST", body: new FormData() }),
  );
  expect(response.status).toBe(415);
  expect(state.mutate).not.toHaveBeenCalled();
});

test("same-origin JSON mutations remain available", async () => {
  const response = await POST(
    new Request("https://app.example/api/trpc/clearAll", {
      method: "POST",
      headers: { origin: "https://app.example", "content-type": "application/json" },
      body: "null",
    }),
  );
  expect(response.status).toBe(200);
  expect(state.mutate).toHaveBeenCalledOnce();
});

test("read-only queries remain available", async () => {
  expect((await GET(new Request("https://app.example/api/trpc/get"))).status).toBe(200);
});

test("oversized chunked RPC input is canceled before mutation execution", async () => {
  const cancel = vi.fn();
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel,
  });
  const response = await POST(
    new Request("https://app.example/api/trpc/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body,
      duplex: "half",
    } as RequestInit),
  );
  expect(response.status).toBe(413);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(chunks).toBeLessThan(35);
  expect(cancel).toHaveBeenCalledOnce();
});

const MB = 1024 * 1024;

/** A same-origin JSON mutation whose body is just over `bytes` long. */
function post(path: string, bytes: number, batch = false) {
  const text = JSON.stringify("a".repeat(bytes));
  const body = batch ? `{${path.split(",").map((_, index) => `"${index}":${text}`)}}` : text;
  return POST(
    new Request(`https://app.example/api/trpc/${path}${batch ? "?batch=1" : ""}`, {
      method: "POST",
      headers: { origin: "https://app.example", "content-type": "application/json" },
      body,
    }),
  );
}

test("ordinary procedures refuse bodies over the default limit", async () => {
  expect((await post("echo", TRPC_DEFAULT_BODY_LIMIT)).status).toBe(413);
  expect(state.mutate).not.toHaveBeenCalled();
  expect((await post("echo", TRPC_DEFAULT_BODY_LIMIT - 1024)).status).toBe(200);
});

test("imports and comparison transcripts keep their larger limits", async () => {
  expect((await post("migration.import", 20 * MB)).status).toBe(200);
  // A side sent to /api/chat just under its cap, plus the final answer.
  expect((await post("chat.saveComparison", CHAT_BODY_LIMIT + MB)).status).toBe(200);
  // Two such sides in one session body: over the import's cap, still saved.
  expect((await post("chat.saveComparisonSession", 2 * CHAT_BODY_LIMIT + 2 * MB)).status).toBe(200);
  expect(state.mutate).toHaveBeenCalledTimes(3);

  expect((await post("chat.saveComparison", COMPARISON_SIDE_BODY_LIMIT)).status).toBe(413);
  expect((await post("chat.saveComparisonSession", 2 * COMPARISON_SIDE_BODY_LIMIT)).status).toBe(
    413,
  );
  expect((await post("migration.import", 30 * MB)).status).toBe(413);
  expect(state.mutate).toHaveBeenCalledTimes(3);
});

test("batching with an import cannot lift another procedure's limit", async () => {
  const response = await post("migration.import,echo", 2 * MB, true);
  expect(response.status).toBe(413);
  expect(state.mutate).not.toHaveBeenCalled();
});

test("a batch of large-input calls keeps their limit", async () => {
  const response = await post("migration.import,migration.import", 4 * MB, true);
  expect(response.status).toBe(200);
  expect(state.mutate).toHaveBeenCalledTimes(2);
});
