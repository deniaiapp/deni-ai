import { expect, test } from "vitest";
import { buildChatSystemPrompt } from "./prompt";

const base = { currentDate: "2026-09-20", persistentMemory: null, projectPrompt: null };

test("search asks for inline citation markers only when the search tool is enabled", () => {
  expect(buildChatSystemPrompt({ ...base, searchToolEnabled: true })).toContain("[cite:3]");
  expect(buildChatSystemPrompt({ ...base, browseToolEnabled: true })).not.toContain("[cite:");
});

test("ordinary messages do not claim the user requested regeneration", () => {
  expect(buildChatSystemPrompt(base)).not.toContain("previous answer");
});

test.each(["retry", "detailed", "concise"] as const)(
  "explicit %s keeps regeneration instructions",
  (responseStyle) => {
    expect(buildChatSystemPrompt({ ...base, responseStyle })).toContain("previous answer");
  },
);

test("the assistant advertises questionnaires without removed generation modes", () => {
  expect(buildChatSystemPrompt(base)).toContain("questionnaire` tool");
  expect(buildChatSystemPrompt(base)).not.toContain("Video mode");
});
