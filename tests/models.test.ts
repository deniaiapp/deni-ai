import { describe, expect, test } from "bun:test";
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

    expect(model?.id).toBe("anthropic/claude-sonnet-5.5");
    expect(model?.tier).toBe("free");
    expect(getModelCategory("claude-sonnet-5-5")).toBe("basic");
    expect(getRequiredTierForModel("claude-sonnet-5-5")).toBeNull();
    expect(model?.contextWindow).toBe(1_000_000);
    expect(model?.maxOutputTokens).toBe(128_000);
    expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getModelTokenUsageMultiplier("claude-sonnet-5-5")).toBe(1.5);
    expect(resolveAvailableModelId("anthropic/claude-sonnet-5-5")).toBe(
      "anthropic/claude-sonnet-5.5",
    );
    expect(anthropicModel).toMatchObject({
      display_name: "Claude Sonnet 5.5",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    });
    expect(anthropicModel?.capabilities.effort.xhigh).toEqual({
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

    expect(model?.id).toBe("anthropic/claude-haiku-5.5");
    expect(model?.tier).toBe("free");
    expect(getModelCategory("claude-haiku-5-5")).toBe("basic");
    expect(getRequiredTierForModel("claude-haiku-5-5")).toBeNull();
    expect(model?.contextWindow).toBe(1_000_000);
    expect(model?.maxOutputTokens).toBe(128_000);
    expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getModelTokenUsageMultiplier("claude-haiku-5-5")).toBe(2);
    expect(resolveAvailableModelId("anthropic/claude-haiku-5-5")).toBe(
      "anthropic/claude-haiku-5.5",
    );
    expect(anthropicModel).toMatchObject({
      display_name: "Claude Haiku 5.5",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    });
    expect(anthropicModel?.capabilities.effort.xhigh).toEqual({
      supported: true,
    });
  });
});

describe("Codex long-context model support", () => {
  test("registers GPT-6 Astra at the top usage tier", () => {
    const definition = getModelDefinition("gpt-6-astra");

    expect(definition?.id).toBe("openai/gpt-6-astra");
    expect(definition?.usageTier).toBe(10);
    expect(getModelTokenUsageMultiplier("gpt-6-astra")).toBe(12);
  });

  test("registers GPT-6 Sol and Luna with current context limits", () => {
    for (const slug of ["gpt-6-sol", "gpt-6-luna"]) {
      const definition = getModelDefinition(slug);

      expect(definition?.id).toBe(`openai/${slug}`);
      expect(definition?.contextWindow).toBe(1_050_000);
      expect(definition?.maxOutputTokens).toBe(128_000);
      expect(definition?.tags).toContain("long-context");
      expect(getModelTokenUsageMultiplier(slug)).toBe(
        slug === "gpt-6-sol" ? 3 : 2,
      );
    }
  });

  test("registers GPT-6.1 Sol with the official limits and supported efforts", () => {
    const model = getModelDefinition("gpt-6.1-sol");

    expect(model?.id).toBe("openai/gpt-6.1-sol");
    expect(model?.label).toBe("GPT-6.1 Sol");
    expect(model?.usageTier).toBe(4);
    expect(model?.contextWindow).toBe(1_050_000);
    expect(model?.maxOutputTokens).toBe(128_000);
    expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(resolveAvailableModelId("gpt-6.1-sol")).toBe("openai/gpt-6.1-sol");
    expect(getLongContextUsageMultiplier("gpt-6.1-sol", { input_tokens: 272_001 })).toBe(2);
    expect(getLongContextUsageMultiplier("gpt-6.1-sol", { input_tokens: 272_000 })).toBe(1);
  });

  test("exposes the GPT-5.6 1M context limits", () => {
    for (const model of [
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
    ]) {
      const definition = getModelDefinition(model);

      expect(definition?.contextWindow).toBe(1_050_000);
      expect(definition?.maxOutputTokens).toBe(128_000);
      expect(definition?.tags).toContain("codex");
    }
  });

  test("resolves GPT-6 slugs without a provider prefix", () => {
    expect(resolveAvailableModelId("gpt-6-sol")).toBe("openai/gpt-6-sol");
    expect(resolveAvailableModelId("gpt-6-luna")).toBe("openai/gpt-6-luna");
  });

  test("resolves the Codex gpt-5.6 alias to the Sol model", () => {
    expect(resolveAvailableModelId("gpt-5.6")).toBe("openai/gpt-5.6-sol");
    expect(resolveAvailableModelId("openai/gpt-5.6")).toBe(
      "openai/gpt-5.6-sol",
    );
    expect(getModelContextWindow("gpt-5.6")).toBe(1_050_000);
  });

  test("keeps the existing long-context quota multiplier", () => {
    expect(
      getLongContextUsageMultiplier("gpt-5.6-luna", {
        input_tokens: 900_000,
      }),
    ).toBe(2);
    expect(
      getLongContextUsageMultiplier("gpt-5.6-luna", {
        input_tokens: 200_000,
      }),
    ).toBe(1);
    expect(
      getLongContextUsageMultiplier("gpt-6-luna", {
        input_tokens: 900_000,
      }),
    ).toBe(2);
  });

  test("allows only GPT-6 Luna, Haiku 5.5, Sonnet 5.5, and Gemini 3.8 Flash on the free plan and flags it as default", () => {
    const free = MODEL_DEFINITIONS.filter((model) => model.tier === "free");
    const defaults = listModelDefinitions().filter((model) => model.default);

    expect(free.map((model) => model.id).sort()).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5.5",
      "google/gemini-3.8-flash",
      "openai/gpt-6-luna",
    ]);
    expect(defaults.map((model) => model.id)).toEqual([DEFAULT_MODEL]);
    expect(DEFAULT_MODEL).toBe("openai/gpt-6-luna");
  });

  test("requires a paid plan for unlisted and removed models", () => {
    expect(getRequiredTierForModel("openai/gpt-6-luna")).toBeNull();
    expect(getRequiredTierForModel("openai/gpt-5.5")).toBe("plus");
    expect(getRequiredTierForModel("anthropic/claude-opus-4.8")).toBe("plus");
  });

  test("charges Sonnet 5.5 at 1.5x on the free plan only", () => {
    expect(getModelTokenUsageMultiplier("claude-sonnet-5-5", "free")).toBe(1.5);
    expect(getModelTokenUsageMultiplier("claude-sonnet-5-5", "plus")).toBe(1.5);
    expect(getModelTokenUsageMultiplier("claude-sonnet-5-5")).toBe(1.5);
    expect(getModelTokenUsageMultiplier("gpt-6-luna", "free")).toBe(2);
  });

  test("assigns cost tiers explicitly to every registered model", () => {
    expect(
      MODEL_DEFINITIONS.every(
        (model) => typeof model.usageTier === "number",
      ),
    ).toBe(true);
    expect(getModelTokenUsageMultiplier("openai/gpt-5.6-sol")).toBe(4);
    expect(getModelTokenUsageMultiplier("anthropic/claude-opus-5.5")).toBe(8);
    expect(getModelTokenUsageMultiplier("anthropic/claude-fable-5.1")).toBe(12);
    expect(
      getModelTokenUsageMultiplier("google/gemini-3.1-pro-preview"),
    ).toBe(3);
  });

  test("exposes provider-supported efforts and excludes Voids models", () => {
    expect(MODEL_DEFINITIONS.every((model) => Array.isArray(model.efforts))).toBe(
      true,
    );
    expect(getModelDefinition("openai/gpt-6-astra")?.efforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(getModelDefinition("anthropic/claude-sonnet-4.6")?.efforts).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(
      getModelDefinition("google/gemini-3.8-flash")?.efforts,
    ).toEqual(["low", "medium", "high"]);
    expect(getModelDefinition("glm-4.6")).toBeUndefined();
    expect(getModelDefinition("grok-code-fast-1")).toBeUndefined();
  });
});

describe("usage tiers", () => {
  test("usage is not split by model class: every model spends the one pool", () => {
    for (const model of MODEL_DEFINITIONS) {
      expect(getModelCategory(model.id)).toBe("basic");
    }
    expect(getModelCategory("anthropic/claude-sonnet-5.5")).toBe("basic");
  });

  test("older clients still get a premium flag for Tier 5 and above", () => {
    for (const model of MODEL_DEFINITIONS) {
      expect(isPremiumModelDefinition(model)).toBe(model.usageTier >= 5);
    }
  });

  test("clients still receive the multiplier and premium flag", () => {
    const astra = listModelDefinitions().find((model) => model.id === "openai/gpt-6-astra");
    expect(astra).toMatchObject({ usageTier: 10, tokenUsageMultiplier: 12, premium: true });
    const luna = listModelDefinitions().find((model) => model.id === "openai/gpt-6-luna");
    expect(luna).toMatchObject({ usageTier: 3, tokenUsageMultiplier: 2, premium: false });
  });

  test("Claude Sonnet 5.5 is Tier 2 (1.5x) on every plan", () => {
    expect(getModelTokenUsageMultiplier("anthropic/claude-sonnet-5.5")).toBe(1.5);
    expect(getModelTokenUsageMultiplier("anthropic/claude-sonnet-5.5", "free")).toBe(1.5);
  });
});
