import { expect, test } from "bun:test";
import {
  flattenResponsesInputItems,
  normalizeResponsesInputItems,
} from "../utils/agent/converters";

test("flattens nested Responses input item batches without changing content arrays", () => {
  const textContent = [{ type: "input_text", text: "hello" }];
  const input = [
    { type: "message", role: "user", content: textContent },
    [
      { type: "function_call", call_id: "call_1", arguments: "{}" },
      [[{ type: "function_call_output", call_id: "call_1", output: "ok" }]],
    ],
  ];

  expect(flattenResponsesInputItems(input)).toEqual([
    { type: "message", role: "user", content: textContent },
    { type: "function_call", call_id: "call_1", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ]);
  expect(textContent).toEqual([{ type: "input_text", text: "hello" }]);
});

test("converts Codex app tool outputs without call ids into message context", () => {
  expect(
    normalizeResponsesInputItems([
      {
        type: "function_call_output",
        id: "fco_1",
        name: "send_message_to_thread",
        namespace: "codex_app",
        output: "<codex_delegation>worker result</codex_delegation>",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: [{ type: "output_text", text: "ok" }],
      },
    ]),
  ).toEqual([
    {
      type: "message",
      role: "user",
      content: "<codex_delegation>worker result</codex_delegation>",
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '[{"type":"output_text","text":"ok"}]',
    },
  ]);
});
