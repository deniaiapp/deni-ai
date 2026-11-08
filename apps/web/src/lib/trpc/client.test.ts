import { afterEach, expect, test, vi } from "vitest";
import { makeTRPCClient } from "./client";
import { isBodyTooLargeError } from "./limits";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("large-input mutations travel alone; others are still batched", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      const result = { result: { data: { json: null } } };
      return Response.json(url.includes("batch=1") ? [result, result] : result);
    }),
  );
  const client = makeTRPCClient();

  await Promise.all([
    client.migration.import.mutate({ payload: [] }),
    client.chat.updateChat.mutate({ id: "a", pinned: true }),
    client.chat.updateChat.mutate({ id: "b", pinned: true }),
  ]);

  expect(urls.sort()).toEqual([
    "/api/trpc/chat.updateChat,chat.updateChat?batch=1",
    "/api/trpc/migration.import",
  ]);
});

test("the route's 413 reaches the caller as a too-large error, not a retryable one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      String(input instanceof Request ? input.url : input).includes("saveComparison")
        ? Response.json({ error: "Request body is too large" }, { status: 413 })
        : Response.json({ error: "Service unavailable" }, { status: 503 }),
    ),
  );
  const client = makeTRPCClient();

  const tooLarge = await client.chat.saveComparison.mutate({ messages: [] }).catch((e) => e);
  expect(isBodyTooLargeError(tooLarge)).toBe(true);
  const unavailable = await client.chat.deleteComparison.mutate({ id: "a" }).catch((e) => e);
  expect(unavailable).toBeInstanceOf(Error);
  expect(isBodyTooLargeError(unavailable)).toBe(false);
});
