import { expect, test } from "vitest";
import {
  MAX_IMPORT_ITEMS,
  MigrationPayloadTooLargeError,
  normalizeMigrationPayload,
} from "./migration";

const texts = (messages: { parts: { type: string; text?: string }[] }[]) =>
  messages.map((message) => message.parts.map((part) => `${part.type}:${part.text}`));

test("a ChatGPT export imports the active branch of each conversation", () => {
  const { conversations } = normalizeMigrationPayload([
    {
      title: "Trip",
      create_time: 1_700_000_000,
      update_time: 1_700_000_100,
      current_node: "b2",
      mapping: {
        root: { id: "root", message: null, parent: null, children: ["u1"] },
        u1: {
          id: "u1",
          message: { id: "u1", author: { role: "user" }, content: { parts: ["Plan a trip"] } },
          parent: "root",
          children: ["b1", "b2"],
        },
        b1: {
          id: "b1",
          message: { id: "b1", author: { role: "assistant" }, content: { parts: ["Old answer"] } },
          parent: "u1",
          children: [],
        },
        b2: {
          id: "b2",
          message: { id: "b2", author: { role: "assistant" }, content: { parts: ["New answer"] } },
          parent: "u1",
          children: [],
        },
      },
    },
  ]);

  expect(conversations).toHaveLength(1);
  expect(conversations[0]?.title).toBe("Trip");
  expect(conversations[0]?.createdAt).toEqual(new Date(1_700_000_000_000));
  expect(texts(conversations[0]!.messages)).toEqual([["text:Plan a trip"], ["text:New answer"]]);
});

test("a Claude export imports text, thinking, and extracted attachment text", () => {
  const { conversations } = normalizeMigrationPayload([
    {
      uuid: "c1",
      name: "Review",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:05:00Z",
      chat_messages: [
        {
          uuid: "m1",
          sender: "human",
          text: "Review this",
          content: [{ type: "text", text: "Review this" }],
          attachments: [{ file_name: "notes.md", extracted_content: "# Notes" }],
          files: [{ file_name: "photo.png" }],
        },
        {
          uuid: "m2",
          sender: "assistant",
          text: "Looks good",
          content: [
            { type: "thinking", thinking: "Check the notes" },
            { type: "tool_use", name: "search", input: {} },
            { type: "text", text: "Looks good" },
          ],
        },
      ],
    },
  ]);

  expect(conversations).toHaveLength(1);
  const [conversation] = conversations;
  expect(conversation?.title).toBe("Review");
  expect(conversation?.createdAt).toEqual(new Date("2026-09-01T10:00:00Z"));
  expect(conversation?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(texts(conversation!.messages)).toEqual([
    [
      "text:Review this",
      "text:[Attached file: notes.md]\n\n# Notes",
      "text:[attachment omitted: photo.png]",
    ],
    ["reasoning:Check the notes", "text:Looks good"],
  ]);
});

test("older Claude exports without content blocks use the message text", () => {
  const { conversations } = normalizeMigrationPayload([
    {
      name: "",
      chat_messages: [
        { sender: "human", text: "Hello" },
        { sender: "assistant", text: "Hi there" },
      ],
    },
  ]);

  expect(conversations[0]?.title).toBe("Imported Chat 1");
  expect(texts(conversations[0]!.messages)).toEqual([["text:Hello"], ["text:Hi there"]]);
});

test("a Claude export imports only the branch that ends at the latest message", () => {
  const { conversations } = normalizeMigrationPayload([
    {
      name: "Edited",
      chat_messages: [
        { uuid: "u1", parent_message_uuid: "root", sender: "human", text: "First try" },
        { uuid: "a1", parent_message_uuid: "u1", sender: "assistant", text: "Answer 1" },
        { uuid: "u2", parent_message_uuid: "root", sender: "human", text: "Edited question" },
        { uuid: "a2", parent_message_uuid: "u2", sender: "assistant", text: "Answer 2" },
      ],
    },
  ]);

  expect(texts(conversations[0]!.messages)).toEqual([["text:Edited question"], ["text:Answer 2"]]);
});

test("a Claude conversation with no usable messages is reported, not imported", () => {
  const result = normalizeMigrationPayload([
    { name: "Empty", chat_messages: [{ sender: "assistant", content: [{ type: "tool_use" }] }] },
  ]);

  expect(result.conversations).toEqual([]);
  expect(result.warnings).toEqual(["conversation 1: no usable messages found"]);
});

test("Claude attachments count toward the import caps", () => {
  const attachments = Array.from({ length: MAX_IMPORT_ITEMS }, () => ({ file_name: "a" }));
  expect(() =>
    normalizeMigrationPayload([{ chat_messages: [{ sender: "human", text: "x", attachments }] }]),
  ).toThrow(MigrationPayloadTooLargeError);
});
