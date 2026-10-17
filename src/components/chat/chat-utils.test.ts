import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { expect, test } from "vitest";
import { hasSuccessfulToolPart } from "@/components/chat/chat-utils";

type Part = UIMessagePart<UIDataTypes, UITools>;

const toolPart = (type: string, state: string, toolCallId: string) =>
  ({ type, state, toolCallId, input: {}, output: {} }) as unknown as Part;

test("detects only successful retired generation results", () => {
  const parts = [
    toolPart("tool-image", "output-error", "a"),
    toolPart("tool-video", "output-available", "b"),
    toolPart("tool-video", "output-available", "c"),
  ];

  expect(hasSuccessfulToolPart(parts, "tool-image")).toBe(false);
  expect(hasSuccessfulToolPart(parts, "tool-video")).toBe(true);
  expect(hasSuccessfulToolPart(undefined, "tool-image")).toBe(false);
});
