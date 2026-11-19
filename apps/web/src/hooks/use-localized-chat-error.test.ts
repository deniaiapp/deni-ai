import { expect, test, vi } from "vitest";
import { useLocalizedChatError } from "@/hooks/use-localized-chat-error";

vi.mock("use-intl", () => import("@/test/intl-mock"));

const GENERIC = "An unexpected error occurred.";

// `useChat` surfaces non-2xx `/api/chat` responses as an Error whose message is the JSON body.
const httpError = (error: string) => new Error(JSON.stringify({ error }));

const localize = useLocalizedChatError();

test("plan and guest restrictions show their own message", () => {
  expect(
    localize(
      httpError("This model is not available on your plan. Upgrade to Plus or higher to use it."),
    ),
  ).toBe("This model is not available on your plan. Upgrade to Plus or higher to use it.");
  expect(
    localize(httpError("This model is available on the Pro plan. Upgrade to Pro to use it.")),
  ).toBe("This model is available on the Pro plan. Upgrade to Pro to use it.");
  expect(
    localize(
      httpError("Pro mode is not available on your plan. Upgrade to Plus or higher to use it."),
    ),
  ).toBe("Pro mode is not available on your plan. Upgrade to Plus or higher to use it.");
  expect(localize(httpError("Only GPT-6 Luna is available for guest sessions."))).toBe(
    "Only GPT-6 Luna is available for guest sessions. Log in to use more models.",
  );
  expect(localize(httpError("Pro mode is not available for guest sessions."))).toBe(
    "Pro mode is not available for guest sessions. Log in to use it.",
  );
});

test("request errors without a matching keyword are still explained", () => {
  expect(localize(httpError("Invalid or oversized attachment"))).toBe(
    "An attachment in this chat can't be used. It may be too large, unsupported, or unavailable.",
  );
  expect(localize(httpError("Too many requests. Please slow down."))).toBe(
    "Too many requests. Please slow down.",
  );
  expect(localize(httpError("Chat not found"))).toBe(
    "This chat couldn't be found. It may have been deleted.",
  );
});

test("upstream and context errors keep their placeholders", () => {
  expect(
    localize(
      httpError("OpenAI models are experiencing high demand right now. Please try again later."),
    ),
  ).toBe("OpenAI models are experiencing high demand right now. Please try again later.");
  expect(
    localize(
      httpError(
        "GPT-6 exceeded its context window (400,000 tokens). Start a new chat or trim earlier messages/files.",
      ),
    ),
  ).toBe(
    "GPT-6 exceeded its context window (400,000 tokens). Start a new chat or trim earlier messages/files.",
  );
});

test("usage limit messages are recognized from plain and JSON errors", () => {
  expect(localize(new Error("Usage limit reached for your plan."))).toBe(
    "You've hit the usage limit for your plan.",
  );
  expect(localize(httpError("You've hit the usage limit for your plan."))).toBe(
    "You've hit the usage limit for your plan.",
  );
});

test("unknown and internal errors fall back to the generic message", () => {
  for (const error of [
    httpError("Invalid request body"),
    httpError("Unknown provider"),
    new Error("TypeError: Cannot read properties of undefined"),
    new Error("Failed to fetch"),
    undefined,
    {},
  ]) {
    expect(localize(error)).toBe(GENERIC);
  }
});
