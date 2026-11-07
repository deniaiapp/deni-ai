import { expect, test } from "vitest";
import { collectCitationSources, parseCitationIds, replaceCitationMarkers } from "./chat-citations";

const parts = [
  { type: "text" },
  {
    type: "tool-search",
    state: "output-available",
    output: [
      { id: 1, title: "Tokyo [guide]", url: "https://example.com/tokyo", description: "a" },
      { id: 2, title: "Osaka", url: "https://example.com/osaka", description: "b" },
    ],
  },
  // Results saved before citations existed have no id.
  {
    type: "tool-search",
    state: "output-available",
    output: [{ title: "Old", url: "https://old.example", description: "" }],
  },
  { type: "tool-search", state: "input-available" },
];

test("collects search results by citation id", () => {
  const sources = collectCitationSources(parts);
  expect([...sources.keys()]).toEqual([1, 2]);
  expect(sources.get(2)?.url).toBe("https://example.com/osaka");
});

test("parses marker bodies and drops duplicates or invalid ids", () => {
  expect(parseCitationIds("3, 5,3")).toEqual([3, 5]);
  expect(parseCitationIds("0")).toEqual([]);
});

test("copies citations as markdown links and drops unknown ids", () => {
  const sources = collectCitationSources(parts);
  expect(replaceCitationMarkers("Tokyo is big. [cite:1] Osaka too.[cite:2, 9]", sources)).toBe(
    "Tokyo is big. ([Tokyo \\[guide\\]](https://example.com/tokyo)) Osaka too. ([Osaka](https://example.com/osaka))",
  );
  expect(replaceCitationMarkers("Unknown. [cite:7]", sources)).toBe("Unknown.");
});

test("read-aloud text drops markers entirely", () => {
  expect(replaceCitationMarkers("東京は大きい。[cite:1]次へ", new Map(), "none")).toBe(
    "東京は大きい。次へ",
  );
});
