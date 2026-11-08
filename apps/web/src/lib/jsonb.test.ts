import { expect, test } from "vitest";
import { stringifyForJsonb, toJsonbSafe, toPostgresText } from "./jsonb";

/**
 * What Postgres' JSON lexer rejects: the NUL escape and unpaired surrogate escapes
 * (JSON.stringify escapes a surrogate only when it is unpaired).
 */
function hasRejectedEscape(json: string) {
  return json.includes("\\u0000") || /\\ud[89a-f][0-9a-f]{2}/i.test(json);
}

test("tool output cut in the middle of an emoji is stored with a replacement character", () => {
  const truncated = "Read this 😀".slice(0, -1);
  expect(JSON.stringify({ output: truncated })).toContain("\\ud83d");

  const json = stringifyForJsonb({ output: truncated, nested: [{ text: `\udc00${truncated}` }] });
  expect(hasRejectedEscape(json)).toBe(false);
  expect(JSON.parse(json)).toEqual({
    output: "Read this �",
    nested: [{ text: "�Read this �" }],
  });
});

test("NUL is removed and complete emoji are kept", () => {
  expect(toJsonbSafe({ text: "a\u0000b 😀", list: ["\u0000"] })).toEqual({
    text: "ab 😀",
    list: [""],
  });
  expect(toPostgresText("plain")).toBe("plain");
});

test("object keys are cleaned as well as values", () => {
  const json = stringifyForJsonb({ output: { "a\u0000": 1, ["b" + "😀".slice(0, 1)]: { c: 2 } } });
  expect(hasRejectedEscape(json)).toBe(false);
  expect(JSON.parse(json)).toEqual({ output: { a: 1, "b�": { c: 2 } } });
});
