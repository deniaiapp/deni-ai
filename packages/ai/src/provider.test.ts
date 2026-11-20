import { generateText } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getModelDefinition } from "./models";
import { createCatalogLanguageModel, isCatalogProviderUnavailableError } from "./provider";

type SentRequest = { url: string; headers: Headers; body: Record<string, unknown> };

/** Answers every request like the Deni AI API's chat completions and records what was sent. */
function mockDeniApi() {
  const sent: SentRequest[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  return sent;
}

function catalogModel(id: string) {
  const model = getModelDefinition(id);
  if (!model) throw new Error(`no catalog model ${id}`);
  return model;
}

const keys = { deniApiKey: "deni_test", deniApiBaseUrl: "https://deni.example/v1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCatalogLanguageModel", () => {
  test("calls every catalog model on the Deni AI API under its author-prefixed id", async () => {
    const sent = mockDeniApi();
    for (const id of ["gpt-6-luna", "claude-haiku-5.5", "gemini-3.8-flash"]) {
      const { model, providerOptions } = createCatalogLanguageModel({
        model: catalogModel(id),
        keys,
      });
      await generateText({ model, providerOptions, prompt: "hi" });
    }
    expect(sent.map((request) => request.url)).toEqual(
      Array(3).fill("https://deni.example/v1/chat/completions"),
    );
    expect(sent.map((request) => request.body.model)).toEqual([
      "openai/gpt-6-luna",
      "anthropic/claude-haiku-5.5",
      "google/gemini-3.8-flash",
    ]);
    expect(sent[0]!.headers.get("authorization")).toBe("Bearer deni_test");
  });

  test("asks for prompt caching and sends the effort for Anthropic models", async () => {
    const sent = mockDeniApi();
    const { model, providerOptions } = createCatalogLanguageModel({
      model: catalogModel("claude-sonnet-5.5"),
      reasoningEffort: "high",
      keys,
      extraBody: { thinking: { type: "adaptive" } },
      headers: { "anthropic-beta": "some-beta" },
    });
    await generateText({ model, providerOptions, prompt: "hi" });
    expect(sent[0]!.body).toMatchObject({
      cache_control: { type: "ephemeral" },
      reasoning_effort: "high",
      thinking: { type: "adaptive" },
    });
    expect(sent[0]!.headers.get("anthropic-beta")).toBe("some-beta");
  });

  test("sends the effort for Gemini and OpenAI models, without Anthropic's caching field", async () => {
    const sent = mockDeniApi();
    for (const [id, effort] of [
      ["gemini-3.8-flash", "low"],
      ["gpt-6-sol", "medium"],
    ] as const) {
      const { model, providerOptions } = createCatalogLanguageModel({
        model: catalogModel(id),
        reasoningEffort: effort,
        keys,
      });
      await generateText({ model, providerOptions, prompt: "hi" });
    }
    expect(sent[0]!.body.reasoning_effort).toBe("low");
    expect(sent[1]!.body.reasoning_effort).toBe("medium");
    expect(sent[0]!.body).not.toHaveProperty("cache_control");
    expect(sent[1]!.body).not.toHaveProperty("cache_control");
  });

  test("fails with a recognizable error without the Deni AI API key", () => {
    let error: unknown;
    try {
      createCatalogLanguageModel({ model: catalogModel("claude-haiku-5.5"), keys: {} });
    } catch (caught) {
      error = caught;
    }
    expect(isCatalogProviderUnavailableError(error)).toBe(true);
  });
});
