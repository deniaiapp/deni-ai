import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getModelCategory, getRequiredTierForModel } from "../utils/deni/models";
import {
  ANTHROPIC_MODEL_DEFINITIONS,
  getLongContextUsageMultiplier,
  getModelContextWindow,
  getModelDefinition,
  getModelTokenUsageMultiplier,
  isPremiumModelDefinition,
  DEFAULT_MODEL,
  listModelDefinitions,
  MODEL_DEFINITIONS,
  resolveAvailableModelId,
} from "../utils/agent/models";

describe("Claude Sonnet 5.5 model support", () => {
  test("registers the official model id, limits, pricing tier, and efforts", () => {
    const model = getModelDefinition("claude-sonnet-5-5");
    const anthropicModel = ANTHROPIC_MODEL_DEFINITIONS.find(
      (entry) => entry.id === "claude-sonnet-5-5",
    );

    assert.equal(model?.id, "anthropic/claude-sonnet-5.5");
    assert.equal(model?.tier, "free");
    assert.equal(getModelCategory("claude-sonnet-5-5"), "basic");
    assert.equal(getRequiredTierForModel("claude-sonnet-5-5"), null);
    assert.equal(model?.contextWindow, 1_000_000);
    assert.equal(model?.maxOutputTokens, 128_000);
    assert.deepEqual(model?.efforts, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(getModelTokenUsageMultiplier("claude-sonnet-5-5"), 1.5);
    assert.equal(
      resolveAvailableModelId("anthropic/claude-sonnet-5-5"),
      "anthropic/claude-sonnet-5.5",
    );
    assert.partialDeepStrictEqual(anthropicModel, {
      display_name: "Claude Sonnet 5.5",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    });
    assert.deepEqual(anthropicModel?.capabilities.effort.xhigh, {
      supported: true,
    });
  });
});

describe("Claude Haiku 5.5 model support", () => {
  test("registers the official model id, limits, pricing tier, and efforts", () => {
    const model = getModelDefinition("claude-haiku-5-5");
    const anthropicModel = ANTHROPIC_MODEL_DEFINITIONS.find(
      (entry) => entry.id === "claude-haiku-5-5",
    );

    assert.equal(model?.id, "anthropic/claude-haiku-5.5");
    assert.equal(model?.tier, "free");
    assert.equal(getModelCategory("claude-haiku-5-5"), "basic");
    assert.equal(getRequiredTierForModel("claude-haiku-5-5"), null);
    assert.equal(model?.contextWindow, 1_000_000);
    assert.equal(model?.maxOutputTokens, 128_000);
    assert.deepEqual(model?.efforts, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(getModelTokenUsageMultiplier("claude-haiku-5-5"), 2);
    assert.equal(
      resolveAvailableModelId("anthropic/claude-haiku-5-5"),
      "anthropic/claude-haiku-5.5",
    );
    assert.partialDeepStrictEqual(anthropicModel, {
      display_name: "Claude Haiku 5.5",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    });
    assert.deepEqual(anthropicModel?.capabilities.effort.xhigh, {
      supported: true,
    });
  });
});

describe("Codex long-context model support", () => {
  test("registers GPT-6 Astra at the top usage tier", () => {
    const definition = getModelDefinition("gpt-6-astra");

    assert.equal(definition?.id, "openai/gpt-6-astra");
    assert.equal(definition?.usageTier, 10);
    assert.equal(getModelTokenUsageMultiplier("gpt-6-astra"), 12);
  });

  test("registers GPT-6 Sol and Luna with current context limits", () => {
    for (const slug of ["gpt-6-sol", "gpt-6-luna"]) {
      const definition = getModelDefinition(slug);

      assert.equal(definition?.id, `openai/${slug}`);
      assert.equal(definition?.contextWindow, 1_050_000);
      assert.equal(definition?.maxOutputTokens, 128_000);
      assert.ok(definition?.tags.includes("long-context"));
      assert.equal(getModelTokenUsageMultiplier(slug), slug === "gpt-6-sol" ? 3 : 2);
    }
  });

  test("registers GPT-6.1 Sol with the official limits and supported efforts", () => {
    const model = getModelDefinition("gpt-6.1-sol");

    assert.equal(model?.id, "openai/gpt-6.1-sol");
    assert.equal(model?.label, "GPT-6.1 Sol");
    assert.equal(model?.usageTier, 4);
    assert.equal(model?.contextWindow, 1_050_000);
    assert.equal(model?.maxOutputTokens, 128_000);
    assert.deepEqual(model?.efforts, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(resolveAvailableModelId("gpt-6.1-sol"), "openai/gpt-6.1-sol");
    assert.equal(getLongContextUsageMultiplier("gpt-6.1-sol", { input_tokens: 272_001 }), 2);
    assert.equal(getLongContextUsageMultiplier("gpt-6.1-sol", { input_tokens: 272_000 }), 1);
  });

  test("exposes the 1M context limits on the Codex GPT-6 models", () => {
    for (const model of ["openai/gpt-6-sol", "openai/gpt-6-luna"]) {
      const definition = getModelDefinition(model);

      assert.equal(definition?.contextWindow, 1_050_000);
      assert.equal(definition?.maxOutputTokens, 128_000);
      assert.ok(definition?.tags.includes("codex"));
    }
    assert.equal(getModelContextWindow("gpt-6-sol"), 1_050_000);
  });

  test("no longer registers the removed GPT-5.6 models", () => {
    for (const model of [
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
    ]) {
      assert.equal(getModelDefinition(model), undefined);
    }
  });

  test("resolves GPT-6 slugs without a provider prefix", () => {
    assert.equal(resolveAvailableModelId("gpt-6-sol"), "openai/gpt-6-sol");
    assert.equal(resolveAvailableModelId("gpt-6-luna"), "openai/gpt-6-luna");
  });

  test("resolves the Codex gpt-5.6 alias to the Sol model", () => {
    assert.equal(resolveAvailableModelId("gpt-5.6"), "openai/gpt-5.6-sol");
    assert.equal(resolveAvailableModelId("openai/gpt-5.6"), "openai/gpt-5.6-sol");
  });

  test("keeps the existing long-context quota multiplier", () => {
    assert.equal(
      getLongContextUsageMultiplier("gpt-6-luna", {
        input_tokens: 900_000,
      }),
      2,
    );
    assert.equal(
      getLongContextUsageMultiplier("gpt-6-luna", {
        input_tokens: 200_000,
      }),
      1,
    );
  });

  test("allows only GPT-6 Luna, Haiku 5.5, Sonnet 5.5, and Gemini 3.8 Flash on the free plan and flags it as default", () => {
    const free = MODEL_DEFINITIONS.filter((model) => model.tier === "free");
    const defaults = listModelDefinitions().filter((model) => model.default);

    assert.deepEqual(free.map((model) => model.id).sort(), [
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5.5",
      "google/gemini-3.8-flash",
      "openai/gpt-6-luna",
    ]);
    assert.deepEqual(defaults.map((model) => model.id), [DEFAULT_MODEL]);
    assert.equal(DEFAULT_MODEL, "openai/gpt-6-luna");
  });

  test("requires a paid plan for unlisted and removed models", () => {
    assert.equal(getRequiredTierForModel("openai/gpt-6-luna"), null);
    assert.equal(getRequiredTierForModel("openai/gpt-5.5"), "plus");
    assert.equal(getRequiredTierForModel("anthropic/claude-opus-4.8"), "plus");
  });

  test("charges Sonnet 5.5 at 1.5x on the free plan only", () => {
    assert.equal(getModelTokenUsageMultiplier("claude-sonnet-5-5", "free"), 1.5);
    assert.equal(getModelTokenUsageMultiplier("claude-sonnet-5-5", "plus"), 1.5);
    assert.equal(getModelTokenUsageMultiplier("claude-sonnet-5-5"), 1.5);
    assert.equal(getModelTokenUsageMultiplier("gpt-6-luna", "free"), 2);
  });

  test("assigns cost tiers explicitly to every registered model", () => {
    assert.equal(
      MODEL_DEFINITIONS.every(
        (model) => typeof model.usageTier === "number",
      ),
      true,
    );
    assert.equal(getModelTokenUsageMultiplier("openai/gpt-6-sol"), 3);
    assert.equal(getModelTokenUsageMultiplier("anthropic/claude-opus-5.5"), 8);
    assert.equal(getModelTokenUsageMultiplier("anthropic/claude-fable-5.1"), 12);
    assert.equal(getModelTokenUsageMultiplier("google/gemini-3.8-flash"), 2);
  });

  test("exposes provider-supported efforts and excludes Voids models", () => {
    assert.equal(MODEL_DEFINITIONS.every((model) => Array.isArray(model.efforts)), true);
    assert.deepEqual(getModelDefinition("openai/gpt-6-astra")?.efforts, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    assert.deepEqual(getModelDefinition("anthropic/claude-sonnet-5.5")?.efforts, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    assert.deepEqual(
      getModelDefinition("google/gemini-3.8-flash")?.efforts,
      ["low", "medium", "high"],
    );
    assert.equal(getModelDefinition("glm-4.6"), undefined);
    assert.equal(getModelDefinition("grok-code-fast-1"), undefined);
  });
});

describe("usage tiers", () => {
  test("usage is not split by model class: every model spends the one pool", () => {
    for (const model of MODEL_DEFINITIONS) {
      assert.equal(getModelCategory(model.id), "basic");
    }
    assert.equal(getModelCategory("anthropic/claude-sonnet-5.5"), "basic");
  });

  test("older clients still get a premium flag for Tier 5 and above", () => {
    for (const model of MODEL_DEFINITIONS) {
      assert.equal(isPremiumModelDefinition(model), model.usageTier >= 5);
    }
  });

  test("clients still receive the multiplier and premium flag", () => {
    const astra = listModelDefinitions().find((model) => model.id === "openai/gpt-6-astra");
    assert.partialDeepStrictEqual(astra, { usageTier: 10, tokenUsageMultiplier: 12, premium: true });
    const luna = listModelDefinitions().find((model) => model.id === "openai/gpt-6-luna");
    assert.partialDeepStrictEqual(luna, { usageTier: 3, tokenUsageMultiplier: 2, premium: false });
  });

  test("Claude Sonnet 5.5 is Tier 2 (1.5x) on every plan", () => {
    assert.equal(getModelTokenUsageMultiplier("anthropic/claude-sonnet-5.5"), 1.5);
    assert.equal(getModelTokenUsageMultiplier("anthropic/claude-sonnet-5.5", "free"), 1.5);
  });
});
