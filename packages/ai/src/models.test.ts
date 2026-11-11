import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  getEffectiveTokenMultiplier,
  getModelTokenMultiplier,
  getModelsForGuest,
  getUsagePromotion,
  getModelsForPlanTier,
  isFreePlanModel,
  isModelAllowedForAccount,
  isProModeAllowedForAccount,
  models,
} from "./models";

describe("model access", () => {
  const restrictedModel = models.find((model) => !isFreePlanModel(model.value));

  test("unverified free accounts only see the free catalog", () => {
    assert.ok(restrictedModel);
    assert.deepEqual(
      getModelsForPlanTier("free"),
      models.filter((model) => isFreePlanModel(model.value)),
    );
    assert.equal(isModelAllowedForAccount(restrictedModel.value, "free"), false);
  });

  test("verified free accounts can use the catalog except paid-only models", () => {
    const verifiedOnlyModel = models.find(
      (model) => !model.paidOnly && !model.proOnly && !isFreePlanModel(model.value),
    );
    assert.ok(verifiedOnlyModel);
    assert.deepEqual(
      getModelsForPlanTier("free", true),
      models.filter((model) => !model.paidOnly && !model.proOnly),
    );
    assert.equal(isModelAllowedForAccount(verifiedOnlyModel.value, "free", true), true);
  });

  test("Go unlocks the same catalog as a verified free account", () => {
    assert.deepEqual(getModelsForPlanTier("go"), getModelsForPlanTier("free", true));
  });

  test("paid-only models require Plus or higher", () => {
    assert.equal(isModelAllowedForAccount("gpt-6-astra", "free", true), false);
    assert.equal(isModelAllowedForAccount("gpt-6-astra", "free"), false);
    assert.equal(isModelAllowedForAccount("gpt-6-astra", "go"), false);
    assert.equal(isModelAllowedForAccount("gpt-6-astra", "plus"), true);
    assert.deepEqual(
      getModelsForPlanTier("plus"),
      models.filter((model) => !model.proOnly),
    );
  });

  test("pro unlocks the whole catalog", () => {
    for (const model of models) {
      assert.equal(isModelAllowedForAccount(model.value, "pro"), true);
    }
    assert.deepEqual(getModelsForPlanTier("pro"), models);
  });

  test("retired GPT-5.6 models are no longer in the catalog", () => {
    for (const value of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.equal(
        models.some((model) => model.value === value),
        false,
      );
    }
  });

  test("pro mode requires Plus or higher", () => {
    assert.equal(isProModeAllowedForAccount("free"), false);
    assert.equal(isProModeAllowedForAccount(null), false);
    assert.equal(isProModeAllowedForAccount("go"), false);
    assert.equal(isProModeAllowedForAccount("plus"), true);
    assert.equal(isProModeAllowedForAccount("pro"), true);
  });

  test("guest catalog remains restricted", () => {
    assert.deepEqual(
      getModelsForGuest().map((model) => model.value),
      ["gpt-6-luna"],
    );
  });
});

describe("usage promotions", () => {
  const during = new Date("2026-11-20T12:00:00+09:00");
  const lastMoment = new Date("2026-12-01T23:59:59+09:00");
  const after = new Date("2026-12-02T00:00:00+09:00");

  test("v8 launch: Opus 5.5 counts half and Fable 5.2 three quarters through Dec 1 (JST)", () => {
    for (const [model, factor] of [
      ["claude-opus-5.5", 0.5],
      ["claude-fable-5.2", 0.75],
    ] as const) {
      assert.equal(getUsagePromotion(model, during)?.factor, factor);
      assert.equal(getUsagePromotion(model, lastMoment)?.factor, factor);
      assert.equal(
        getEffectiveTokenMultiplier(model, undefined, { now: during }),
        getModelTokenMultiplier(model) * factor,
      );
    }
  });

  test("after the end, and for other models, usage counts in full", () => {
    for (const model of ["claude-fable-5.2", "claude-opus-5.5"]) {
      assert.equal(getUsagePromotion(model, after), null);
      assert.equal(
        getEffectiveTokenMultiplier(model, undefined, { now: after }),
        getModelTokenMultiplier(model),
      );
    }
    for (const model of ["claude-fable-5.1", "claude-sonnet-5.5", "gpt-6-luna"]) {
      assert.equal(getUsagePromotion(model, during), null);
    }
  });
});
