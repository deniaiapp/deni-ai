import {
  convertToModelMessages,
  createUIMessageStream,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { expect, test } from "vitest";
import { getContinuedAssistantMessage, selectModelContextMessages } from "./chat-messages";

const user = (id: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: id }],
});
const answer = (id: string, branchGroupId?: string): UIMessage => ({
  id,
  role: "assistant",
  ...(branchGroupId ? { metadata: { branchGroupId } } : {}),
  parts: [{ type: "text", text: id, state: "done" }],
});
const questionnaire: UIMessage = {
  id: "asked",
  role: "assistant",
  parts: [
    { type: "step-start" },
    {
      type: "tool-questionnaire",
      toolCallId: "q1",
      state: "output-available",
      input: { title: "Trip" },
      output: { answers: ["Kyoto"] },
    },
  ],
};
const continuation: UIMessageChunk[] = [
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Here is the plan." },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
];

function toolCallIds(messages: Awaited<ReturnType<typeof convertToModelMessages>>) {
  return messages.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.flatMap((part) => (part.type === "tool-call" ? [part.toolCallId] : []))
      : [],
  );
}

test("only the shown branch of a regenerated answer reaches the model", () => {
  const messages = [user("q1"), answer("a1", "g"), answer("a2", "g"), user("q2")];
  expect(selectModelContextMessages(messages).map((message) => message.id)).toEqual([
    "q1",
    "a2",
    "q2",
  ]);
  // Stored alternatives are left alone for the branch picker.
  expect(messages).toHaveLength(4);
});

test("a regenerate drops the alternatives of the answer it replaces", () => {
  // Retrying the shown alternative a2 truncates the client state to [q1, a1].
  const messages = [user("q1"), answer("a1", "g")];
  expect(
    selectModelContextMessages(messages, { regenerate: true }).map((message) => message.id),
  ).toEqual(["q1"]);
  expect(selectModelContextMessages(messages).map((message) => message.id)).toEqual(["q1", "a1"]);
});

test("a legacy questionnaire continuation copy does not repeat tool call IDs", async () => {
  const legacyCopy: UIMessage = {
    id: "copy",
    role: "assistant",
    parts: [...questionnaire.parts, { type: "step-start" }, { type: "text", text: "Plan" }],
  };
  const selected = selectModelContextMessages([user("q1"), questionnaire, legacyCopy, user("q2")]);
  expect(selected.map((message) => message.id)).toEqual(["q1", "copy", "q2"]);
  expect(toolCallIds(await convertToModelMessages(selected))).toEqual(["q1"]);
});

test("only a questionnaire answer continues the trailing assistant message", () => {
  expect(getContinuedAssistantMessage([user("q1"), questionnaire], "submit-message")).toBe(
    questionnaire,
  );
  expect(getContinuedAssistantMessage([user("q1"), questionnaire], undefined)).toBe(questionnaire);
  expect(
    getContinuedAssistantMessage([user("q1"), answer("a1", "g")], "regenerate-message"),
  ).toBeUndefined();
  expect(getContinuedAssistantMessage([user("q1")], "submit-message")).toBeUndefined();
  expect(getContinuedAssistantMessage([user("q1"), answer("")], "submit-message")).toBeUndefined();
});

test("a continued answer is saved in place under its own message ID", async () => {
  // Mirrors the chat route: the pending entry replaces the continued message
  // and seeds both the response and the partial saves.
  const pending: UIMessage = { ...questionnaire, metadata: { pending: true } };
  let finished: UIMessage[] = [];
  const response = createUIMessageStream<UIMessage>({
    originalMessages: [user("q1"), pending],
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: questionnaire.id });
      for (const chunk of continuation) writer.write(chunk);
    },
    onFinish: ({ messages }) => {
      finished = messages;
    },
  });
  for await (const chunk of response) void chunk;

  expect(finished.map((message) => message.id)).toEqual(["q1", "asked"]);
  expect(finished.at(-1)?.parts.map((part) => part.type)).toEqual([
    "step-start",
    "tool-questionnaire",
    "step-start",
    "text",
  ]);
  expect(toolCallIds(await convertToModelMessages([...finished, user("q2")]))).toEqual(["q1"]);

  // The persistence branch never sees a start chunk.
  const partials: UIMessage[] = [];
  for await (const message of readUIMessageStream({
    message: structuredClone(pending),
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of continuation) controller.enqueue(chunk);
        controller.close();
      },
    }),
  })) {
    partials.push(message);
  }
  expect(partials.length).toBeGreaterThan(0);
  expect(partials.every((message) => message.id === questionnaire.id)).toBe(true);
  expect(partials.at(-1)?.parts).toHaveLength(4);
});
