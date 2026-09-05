import { expect, test } from "bun:test";
import { flattenResponsesInputItems } from "../utils/agent/converters";

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
