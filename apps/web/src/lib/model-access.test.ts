import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  getModelsForGuest,
  getModelsForPlanTier,
  isFreePlanModel,
  isModelAllowedForAccount,
  isProModeAllowedForAccount,
  models,
} from "./constants";

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

  test("pro-only models require Pro", () => {
    for (const value of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.equal(isModelAllowedForAccount(value, "free", true), false);
      assert.equal(isModelAllowedForAccount(value, "go"), false);
      assert.equal(isModelAllowedForAccount(value, "plus"), false);
      assert.equal(isModelAllowedForAccount(value, "pro"), true);
    }
    assert.deepEqual(getModelsForPlanTier("pro"), models);
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
