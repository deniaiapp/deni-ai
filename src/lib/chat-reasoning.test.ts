import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { expect, test } from "vitest";
import { stripEarlierTurnReasoning } from "./chat-reasoning";

const signed = (signature: string) => ({
  openrouter: {
    reasoning_details: [
      { type: "reasoning.text", text: "thinking", signature, format: "anthropic-claude-v1" },
    ],
  },
});

const user = (text: string): ModelMessage => ({ role: "user", content: text });

test("drops signed reasoning from turns before the last user message", () => {
  const messages: ModelMessage[] = [
    user("q1"),
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking", providerOptions: signed("old") },
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "search",
          input: { query: "x" },
          providerOptions: { openrouter: { ...signed("old").openrouter, other: true } },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "search",
          output: { type: "text", value: "result" },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking", providerOptions: signed("old") },
        { type: "text", text: "a1" },
      ],
    },
    user("q2"),
  ];

  expect(stripEarlierTurnReasoning(messages)).toEqual([
    user("q1"),
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "search",
          input: { query: "x" },
          providerOptions: { openrouter: { other: true } },
        },
      ],
    },
    messages[2],
    { role: "assistant", content: [{ type: "text", text: "a1" }] },
    user("q2"),
  ]);
});

test("keeps the reasoning of the turn being continued", () => {
  const continued: ModelMessage = {
    role: "assistant",
    content: [
      { type: "reasoning", text: "thinking", providerOptions: signed("current") },
      {
        type: "tool-call",
        toolCallId: "q1",
        toolName: "questionnaire",
        input: {},
        providerOptions: signed("current"),
      },
    ],
  };
  const messages = [user("q1"), continued];

  expect(stripEarlierTurnReasoning(messages)).toEqual(messages);
});

test("drops an earlier turn that only reasoned", () => {
  const messages: ModelMessage[] = [
    user("q1"),
    { role: "assistant", content: [{ type: "reasoning", text: "thinking" }] },
    user("q2"),
  ];

  expect(stripEarlierTurnReasoning(messages)).toEqual([user("q1"), user("q2")]);
});

test("removes signatures stored on persisted UI messages", async () => {
  const messages: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "q1" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "thinking", state: "done", providerMetadata: signed("old") },
        { type: "text", text: "a1", state: "done" },
      ],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "q2" }] },
  ];

  const stripped = stripEarlierTurnReasoning(await convertToModelMessages(messages));

  expect(JSON.stringify(stripped)).not.toContain("signature");
  expect(stripped[1]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "a1" }] });
});
