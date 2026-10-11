import { expect, test } from "vitest";
import { getPreferredLocaleFromHeader } from "./accept-language";

test.each([
  ["en-US,en;q=0.9,ja;q=0.8", "en"],
  ["en, ja;q=0", "en"],
  ["fr, ja;q=0", null],
  ["ja-JP,en;q=0.5", "ja"],
  ["ja,en;q=0.8", "ja"],
  ["en;q=0.5, ja;q=0.9", "ja"],
  ["en;q=0.8, ja;q=0.8", "en"],
  ["fr-FR, ja-JP;q=0.7", "ja"],
  ["JA", "ja"],
  ["jam", null],
  ["*", null],
  ["", null],
  [null, null],
])("negotiates %j as %j", (header, expected) => {
  expect(getPreferredLocaleFromHeader(header)).toBe(expected);
});
