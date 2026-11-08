import { describe, expect, test } from "vitest";
import {
  ALLOWED_EDU_DOMAIN_SUFFIXES,
  computeWeightedTokens,
  DEFAULT_TOKEN_USAGE_WEIGHTS,
  extractEmailDomain,
  FLAGGED_FREE_POOL_USD,
  getUsageTierMultiplier,
  isAllowedEducationalDomain,
  isEducationalEmail,
  parseTokenUsageWeight,
  resolveTokenUsageWeights,
  USAGE_POOL_USD,
  USAGE_TIER_MULTIPLIERS,
  USAGE_UNITS_PER_USD,
  USAGE_UNITS_PER_USD_MICRO,
  usageUnitsToUsd,
  usdToUsageUnits,
  VERIFIED_FREE_POOL_USD,
} from "./index";

// These values are billing policy: changing one changes what users are charged
// in both Deni AI chat and Flixa, so the test pins them explicitly.
describe("usage pool", () => {
  test("pool sizes per plan", () => {
    expect(USAGE_POOL_USD).toEqual({ free: 10, go: 30, plus: 100, pro: 200 });
    expect(VERIFIED_FREE_POOL_USD).toBe(15);
    expect(FLAGGED_FREE_POOL_USD).toBe(2);
  });

  test("units per USD", () => {
    expect(USAGE_UNITS_PER_USD).toBe(2_000_000);
    expect(USAGE_UNITS_PER_USD_MICRO).toBe(2);
    expect(usdToUsageUnits(USAGE_POOL_USD.pro)).toBe(400_000_000);
    expect(usdToUsageUnits(0.0000003)).toBe(1);
    expect(usageUnitsToUsd(1_000_000)).toBe(0.5);
  });
});

describe("usage tiers", () => {
  test("multiplier ladder", () => {
    expect(USAGE_TIER_MULTIPLIERS).toEqual({
      1: 1,
      2: 1.5,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      7: 6,
      8: 8,
      9: 10,
      10: 12,
    });
  });

  test("an unset tier counts as Tier 1", () => {
    expect(getUsageTierMultiplier(undefined)).toBe(1);
    expect(getUsageTierMultiplier(8)).toBe(8);
  });
});

describe("token weighting", () => {
  test("defaults", () => {
    expect(DEFAULT_TOKEN_USAGE_WEIGHTS).toEqual({
      input: 1,
      cacheRead: 0.1,
      cacheWrite: 1.25,
      output: 5,
    });
    expect(resolveTokenUsageWeights({})).toEqual(DEFAULT_TOKEN_USAGE_WEIGHTS);
  });

  test("overrides keep parseFloat semantics and reject invalid values", () => {
    expect(parseTokenUsageWeight("", 3)).toBe(3);
    expect(parseTokenUsageWeight(undefined, 3)).toBe(3);
    expect(parseTokenUsageWeight("0", 3)).toBe(0);
    expect(parseTokenUsageWeight("2x", 3)).toBe(2);
    expect(parseTokenUsageWeight("-1", 3)).toBe(3);
    expect(parseTokenUsageWeight("Infinity", 3)).toBe(3);
    expect(parseTokenUsageWeight("abc", 3)).toBe(3);
    expect(
      resolveTokenUsageWeights({
        FLIXA_USAGE_WEIGHT_INPUT: "2",
        FLIXA_USAGE_WEIGHT_CACHE_READ: "0.2",
        FLIXA_USAGE_WEIGHT_CACHE_WRITE: "",
        FLIXA_USAGE_WEIGHT_OUTPUT: "-5",
      }),
    ).toEqual({ input: 2, cacheRead: 0.2, cacheWrite: 1.25, output: 5 });
  });

  test("weighted tokens round up", () => {
    expect(
      computeWeightedTokens(
        { input: 100, cacheRead: 1_001, cacheWrite: 10, output: 20 },
        DEFAULT_TOKEN_USAGE_WEIGHTS,
      ),
    ).toBe(Math.ceil(100 + 100.1 + 12.5 + 100));
  });
});

describe("education domains", () => {
  test("restricted-registration suffixes", () => {
    expect(ALLOWED_EDU_DOMAIN_SUFFIXES).toEqual([
      "edu",
      "ac.jp",
      "ed.jp",
      "ac.uk",
      "sch.uk",
      "edu.au",
      "ac.nz",
      "ac.kr",
      "edu.tw",
      "edu.sg",
      "edu.hk",
    ]);
  });

  test.each([
    ["student@mit.edu", true],
    ["a@cs.stanford.edu", true],
    ["a@U-Tokyo.AC.JP", true],
    ["a@school.ed.jp.", true],
    ["a@ox.ac.uk", true],
    ["a@edu", false],
    ["a@cmuk.edu.kg", false],
    ["a@foo.edu.co", false],
    ["a@something.ac", false],
    ["not-an-email", false],
    ["@mit.edu", false],
  ])("isEducationalEmail(%s) = %s", (email, expected) => {
    expect(isEducationalEmail(email)).toBe(expected);
  });

  test("domain helpers", () => {
    expect(extractEmailDomain(" User@Example.COM.. ")).toBe("example.com");
    expect(extractEmailDomain("user@")).toBeNull();
    expect(isAllowedEducationalDomain("edu")).toBe(false);
  });
});
