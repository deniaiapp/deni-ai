import { expect, test } from "vitest";
import {
  getRecentPromptUsage,
  isCurrentChatGeneration,
  isChatStopRequestedSince,
  recordChatStopRequest,
  recordPromptUsage,
  startChatGeneration,
  stopChatGeneration,
} from "./chat-generation";

// The AI SDK and Sentry treat only AbortError reasons as an abort; a bare string
// reason surfaced as an unhandled "Failed to process successful response" error.
test("replaced and stopped generations abort with an AbortError", () => {
  const first = startChatGeneration("abort-reason", "first");
  const second = startChatGeneration("abort-reason", "second");
  expect(first.abortController.signal.reason).toMatchObject({
    name: "AbortError",
    message: "replaced",
  });
  expect(isCurrentChatGeneration("abort-reason", "second")).toBe(true);

  expect(stopChatGeneration("abort-reason", "second")).toBe(true);
  expect(second.abortController.signal.reason).toMatchObject({
    name: "AbortError",
    message: "stopped",
  });
});

test("a stop that arrives before the generation registers still applies to it", () => {
  const requestArrivedAt = 1_000;
  recordChatStopRequest("early-stop", requestArrivedAt + 50);
  expect(isChatStopRequestedSince("early-stop", requestArrivedAt, requestArrivedAt + 200)).toBe(
    true,
  );
});

test("a stop never applies to a request sent after it", () => {
  recordChatStopRequest("later-request", 1_000);
  expect(isChatStopRequestedSince("later-request", 1_000, 1_100)).toBe(false);
  expect(isChatStopRequestedSince("later-request", 1_001, 1_100)).toBe(false);
  expect(isChatStopRequestedSince("other-chat", 900, 1_100)).toBe(false);
});

test("an out-of-order older stop does not replace a newer one", () => {
  recordChatStopRequest("two-stops", 2_000);
  recordChatStopRequest("two-stops", 1_500);
  expect(isChatStopRequestedSince("two-stops", 1_800, 2_100)).toBe(true);
});

test("stop requests expire", () => {
  recordChatStopRequest("expired-stop", 1_000);
  expect(isChatStopRequestedSince("expired-stop", 900, 1_000 + 61_000)).toBe(false);
});

test("a later call's usage keeps the prompt reported by an earlier call", () => {
  const prompt = { inputTokens: 30_000, messageCount: 1, fingerprint: "first-call" };
  recordPromptUsage("prompt-usage", { cacheReadTokens: 0, prompt }, 1_000);
  recordPromptUsage("prompt-usage", { cacheReadTokens: 25_000 }, 2_000);
  expect(getRecentPromptUsage("prompt-usage", 2_500)).toEqual({ cacheReadTokens: 25_000, prompt });
});

test("reported prompt usage expires", () => {
  const prompt = { inputTokens: 30_000, messageCount: 1, fingerprint: "first-call" };
  recordPromptUsage("expired-usage", { cacheReadTokens: 1_000, prompt }, 1_000);
  expect(getRecentPromptUsage("expired-usage", 1_000 + 6 * 60_000)).toEqual({
    cacheReadTokens: 0,
  });
});
