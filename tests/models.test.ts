import { describe, expect, test } from "bun:test";
import { getModelCategory } from "../utils/deni/models";
import {
  getLongContextUsageMultiplier,
  getModelContextWindow,
  getModelDefinition,
  getModelTokenUsageMultiplier,
  resolveAvailableModelId,
} from "../utils/agent/models";

describe("Codex long-context model support", () => {
  test("registers GPT-6 Astra as a Fable-priced premium model", () => {
    const definition = getModelDefinition("gpt-6-astra");

    expect(definition?.id).toBe("openai/gpt-6-astra");
    expect(definition?.premium).toBe(true);
    expect(getModelCategory("gpt-6-astra")).toBe("premium");
    expect(getModelTokenUsageMultiplier("gpt-6-astra")).toBe(5);
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
  });
});
