import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_MODE,
  joinRunMode,
  parseRunMode,
  runModeForAccount,
  runModeLabel,
  splitRunMode,
} from "./model";

describe("run mode", () => {
  it("is a chat catalog model and a reasoning effort", () => {
    // The chat default model, at its preferred effort.
    expect(DEFAULT_RUN_MODE).toBe("claude-haiku-5.5@high");
    expect(splitRunMode("gpt-6-sol@high")).toEqual({ model: "gpt-6-sol", reasoningEffort: "high" });
    expect(runModeLabel("claude-opus-5.5@max")).toBe("Claude Opus 5.5 (max)");
  });

  it("reads the modes saved before Run used the chat catalog", () => {
    expect(parseRunMode("default")).toBe("claude-sonnet-5.5@medium");
    expect(parseRunMode("xhigh")).toBe("claude-sonnet-5.5@xhigh");
    expect(parseRunMode("plus-high")).toBe("claude-opus-5.5@high");
    expect(parseRunMode("plus")).toBe("claude-opus-5.5@max");
  });

  it("falls back to the default for unknown values", () => {
    for (const value of [undefined, null, "", "no-such-model@high", 3])
      expect(parseRunMode(value)).toBe(DEFAULT_RUN_MODE);
  });

  it("keeps the effort only when the model supports it", () => {
    // Gemini 3.8 Flash has no xhigh: the model's preferred effort is used instead.
    expect(joinRunMode("gemini-3.8-flash", "xhigh")).toBe("gemini-3.8-flash@high");
    expect(parseRunMode("claude-sonnet-5.5@nonsense")).toBe("claude-sonnet-5.5@high");
  });

  it("applies the chat plan rules to the saved model", () => {
    // Free without a verified card: only the free models, so Sonnet falls back to the default.
    expect(runModeForAccount("claude-sonnet-5.5@medium", { tier: "free" })).toBe(
      "claude-haiku-5.5@medium",
    );
    expect(
      runModeForAccount("claude-sonnet-5.5@medium", {
        tier: "free",
        hasVerifiedPaymentMethod: true,
      }),
    ).toBe("claude-sonnet-5.5@medium");
    // A paid-only model after a downgrade to Go.
    expect(runModeForAccount("claude-fable-5.2@high", { tier: "go" })).toBe(
      "claude-haiku-5.5@high",
    );
    expect(runModeForAccount("claude-fable-5.2@high", { tier: "plus" })).toBe(
      "claude-fable-5.2@high",
    );
  });

  it("skips models the server cannot call", () => {
    const onlyOpenAI = runModeForAccount("claude-sonnet-5.5@medium", {
      tier: "pro",
      isAvailable: (model) => model.author === "openai",
    });
    expect(splitRunMode(onlyOpenAI).model).toBe("gpt-6-luna");
  });
});
