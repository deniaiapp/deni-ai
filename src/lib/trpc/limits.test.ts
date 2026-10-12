import { expect, test } from "vitest";
import { CHAT_BODY_LIMIT } from "@/lib/request-body";
import {
  COMPARISON_SIDE_BODY_LIMIT,
  hasLargeBodyLimit,
  isBodyTooLargeError,
  TRPC_DEFAULT_BODY_LIMIT,
  trpcBodyLimit,
} from "./limits";

const MB = 1024 * 1024;

test("only the import keeps the 30 MB limit", () => {
  expect(trpcBodyLimit(["migration.import"])).toBe(30 * MB);
  expect(trpcBodyLimit(["chat.updateChat"])).toBe(TRPC_DEFAULT_BODY_LIMIT);
  expect(TRPC_DEFAULT_BODY_LIMIT).toBe(2 * MB);
});

test("a comparison /api/chat accepted can be saved, final answers included", () => {
  // Each side's last chat request was at most the chat cap; its answer comes on top.
  expect(COMPARISON_SIDE_BODY_LIMIT).toBe(CHAT_BODY_LIMIT + 4 * MB);
  expect(trpcBodyLimit(["chat.saveComparison"])).toBe(COMPARISON_SIDE_BODY_LIMIT);
  // A session carries both sides in one body.
  expect(trpcBodyLimit(["chat.saveComparisonSession"])).toBe(2 * COMPARISON_SIDE_BODY_LIMIT);
  expect(trpcBodyLimit(["chat.saveComparisonSession"])).toBe(40 * MB);
});

test("a batch gets the smallest limit among its calls", () => {
  expect(trpcBodyLimit(["migration.import", "migration.import"])).toBe(30 * MB);
  expect(trpcBodyLimit(["migration.import", "chat.saveComparison"])).toBe(20 * MB);
  expect(trpcBodyLimit(["chat.saveComparisonSession", "migration.import"])).toBe(30 * MB);
  expect(trpcBodyLimit(["migration.import", "chat.updateChat"])).toBe(TRPC_DEFAULT_BODY_LIMIT);
});

test("inherited property names and empty input fall back to the default", () => {
  for (const path of ["constructor", "__proto__", "toString", "hasOwnProperty", ""]) {
    expect(trpcBodyLimit([path])).toBe(TRPC_DEFAULT_BODY_LIMIT);
    expect(hasLargeBodyLimit(path)).toBe(false);
  }
  expect(trpcBodyLimit([])).toBe(TRPC_DEFAULT_BODY_LIMIT);
});

test("large-input procedures are the ones the client sends unbatched", () => {
  expect(hasLargeBodyLimit("migration.import")).toBe(true);
  expect(hasLargeBodyLimit("chat.saveComparisonSession")).toBe(true);
  expect(hasLargeBodyLimit("chat.saveComparison")).toBe(true);
  expect(hasLargeBodyLimit("chat.getChats")).toBe(false);
});

test("only a 413 or PAYLOAD_TOO_LARGE counts as a body over the cap", () => {
  expect(isBodyTooLargeError({ meta: { response: new Response(null, { status: 413 }) } })).toBe(
    true,
  );
  expect(isBodyTooLargeError({ data: { code: "PAYLOAD_TOO_LARGE" } })).toBe(true);
  for (const other of [
    { meta: { response: new Response(null, { status: 500 }) } },
    { data: { code: "BAD_REQUEST" } },
    { data: null, meta: { response: null } },
    new Error("Request body is too large"),
    "413",
    null,
    undefined,
  ]) {
    expect(isBodyTooLargeError(other)).toBe(false);
  }
});
