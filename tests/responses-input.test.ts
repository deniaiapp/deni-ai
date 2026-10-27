import assert from "node:assert/strict";
import { test } from "node:test";
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

  assert.deepEqual(flattenResponsesInputItems(input), [
    { type: "message", role: "user", content: textContent },
    { type: "function_call", call_id: "call_1", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ]);
  assert.deepEqual(textContent, [{ type: "input_text", text: "hello" }]);
});

test("flattens wide and deeply nested Responses input in a single pass", () => {
  let nested: unknown = { type: "message", role: "user", content: "deep" };
  for (let depth = 0; depth < 20_000; depth++) {
    nested = [nested];
  }
  const input: unknown[] = Array.from({ length: 100_000 }, (_, index) => index);
  input.push(nested);

  const started = performance.now();
  const flattened = flattenResponsesInputItems(input) as unknown[];
  const elapsedMs = performance.now() - started;

  assert.equal(flattened.length, 100_001);
  assert.equal(flattened[99_999], 99_999);
  assert.deepEqual(flattened[100_000], { type: "message", role: "user", content: "deep" });
  assert.ok(elapsedMs < 2_000);
});

test("returns non-nested Responses input unchanged", () => {
  const input = [{ type: "message", role: "user", content: "hi" }];
  assert.equal(flattenResponsesInputItems(input), input);
  assert.equal(flattenResponsesInputItems("hi"), "hi");
});

test("converts Codex app tool outputs without call ids into message context", () => {
  assert.deepEqual(
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
    [
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
    ],
  );
});
