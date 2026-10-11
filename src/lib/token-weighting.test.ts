import { afterEach, expect, test, vi } from "vitest";
import {
  breakdownFromLanguageModelUsage,
  computeWeightedTokens,
  computeWeightedUsageFromLanguageModelUsage,
  getTokenUsageWeights,
} from "./token-weighting";

const keys = [
  "FLIXA_USAGE_WEIGHT_INPUT",
  "FLIXA_USAGE_WEIGHT_CACHE_READ",
  "FLIXA_USAGE_WEIGHT_CACHE_WRITE",
  "FLIXA_USAGE_WEIGHT_OUTPUT",
] as const;
const defaults = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function weights(values: string[]) {
  vi.resetModules();
  keys.forEach((key, index) => vi.stubEnv(key, values[index]));
  return (await import("./token-weighting")).getTokenUsageWeights();
}

test("empty weights retain the existing defaults", async () => {
  expect(await weights(["", "", "", ""])).toEqual(defaults);
});

test("finite nonnegative parseFloat values, including zero and prefixes, are preserved", async () => {
  expect(await weights(["0", "0.2suffix", " 2.5 ", "6"])).toEqual({
    input: 0,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    output: 6,
  });
});

test("invalid, negative and non-finite weights retain defaults", async () => {
  expect(await weights(["bad", "-1", "Infinity", "NaN"])).toEqual(defaults);
});

test("component weighting rounds up once", () => {
  expect(getTokenUsageWeights()).toEqual(defaults);
  expect(
    computeWeightedTokens({ input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, defaults),
  ).toBe(8);
});

test("cache writes left inside OpenRouter's noCache count once", () => {
  const { breakdown, weighted } = computeWeightedUsageFromLanguageModelUsage({
    inputTokens: 100,
    outputTokens: 0,
    inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 100 },
  });
  expect(breakdown).toEqual({ input: 0, cacheRead: 0, cacheWrite: 100, output: 0 });
  expect(weighted).toBe(125);
});

test("providers that exclude cache writes from noCache are unchanged", () => {
  expect(
    breakdownFromLanguageModelUsage({
      inputTokens: 150,
      outputTokens: 10,
      inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 100 },
    }),
  ).toEqual({ input: 50, cacheRead: 0, cacheWrite: 100, output: 10 });
});
