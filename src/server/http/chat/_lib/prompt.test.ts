import { expect, test } from "vitest";
import { buildChatSystemPrompt } from "./prompt";

const base = { currentDate: "2026-09-20", persistentMemory: null, projectPrompt: null };

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
