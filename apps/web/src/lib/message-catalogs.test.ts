import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

function readCatalog(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"),
  ) as Record<string, string>;
}

const en = readCatalog("en");
const ja = readCatalog("ja");

// Message extraction adds a new message to ja.json as "", which the app shows as
// its catalog key (for example "o69P_E") instead of text.
test("every message has a Japanese translation", () => {
  const untranslated = Object.keys(en).filter((key) => !ja[key]?.trim());
  expect(untranslated).toEqual([]);
});

test("the Japanese catalog has no keys the source catalog dropped", () => {
  const stale = Object.keys(ja).filter((key) => !(key in en));
  expect(stale).toEqual([]);
});
