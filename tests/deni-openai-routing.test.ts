import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  convertResponsesInputContentToChat,
  getClient,
  toDeniResponsesRequest,
} from "../utils/agent";

const ENV_KEYS = ["DENI_AI_API_KEY", "DENI_AI_API_BASE_URL"] as const;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  process.env.DENI_AI_API_KEY = "deni_test_key_0123456789";
  delete process.env.DENI_AI_API_BASE_URL;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("getClient", () => {
  test("routes OpenAI models to Deni AI API", () => {
    const result = getClient("openai/gpt-6-luna");
    if ("error" in result) throw new Error(result.error);
    if (result.type !== "deni") throw new Error(`routed to ${result.type}`);

    expect(result.providerName).toBe("deni-ai");
    expect(result.client.baseURL).toBe("https://api.deniai.app/v1");
    expect(result.client.apiKey).toBe("deni_test_key_0123456789");
  });

  test("requires DENI_AI_API_KEY for OpenAI models", () => {
    delete process.env.DENI_AI_API_KEY;
    try {
      expect(getClient("openai/gpt-6-luna")).toEqual({
        error: "DENI_AI_API_KEY is required for OpenAI models",
      });
    } finally {
      process.env.DENI_AI_API_KEY = "deni_test_key_0123456789";
    }
  });

  test("keeps other providers on OpenRouter", () => {
    const previous = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "local-test-key";
    try {
      const result = getClient("anthropic/claude-sonnet-5.5");
      if ("error" in result) throw new Error(result.error);
      expect(result.type).toBe("openrouter");
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
  });
});

test("converts Responses content parts to Chat Completions parts", () => {
  expect(
    convertResponsesInputContentToChat([
      {
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,AA", detail: "low" },
        ],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
      { type: "function_call_output", call_id: "call_1", output: "done" },
    ]),
  ).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "low" } },
      ],
    },
    { type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] },
    { type: "function_call_output", call_id: "call_1", output: "done" },
  ]);
});

describe("toDeniResponsesRequest", () => {
  test("keeps only fields Deni reads, in Chat-compatible shapes", () => {
    expect(
      toDeniResponsesRequest({
        model: "openai/gpt-6-luna",
        instructions: "be brief",
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        stream: true,
        reasoning: { effort: "high", context: "all_turns" },
        include: ["reasoning.encrypted_content"],
        store: false,
        prompt_cache_key: "thread-1",
        tools: [{ type: "function", name: "shell", parameters: { type: "object" } }],
        tool_choice: { type: "function", name: "shell" },
      }),
    ).toEqual({
      model: "openai/gpt-6-luna",
      instructions: "be brief",
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      stream: true,
      max_output_tokens: 128_000,
      tools: [{ type: "function", name: "shell", parameters: { type: "object" } }],
      tool_choice: { type: "function", function: { name: "shell" } },
    });
  });

  test("keeps a client max_output_tokens", () => {
    expect(
      toDeniResponsesRequest({
        model: "openai/gpt-6-luna",
        input: "hi",
        max_output_tokens: 2048,
      }).max_output_tokens,
    ).toBe(2048);
  });

  test("drops tool_choice without tools", () => {
    expect(
      toDeniResponsesRequest({
        model: "openai/gpt-6-luna",
        input: "hi",
        tool_choice: "auto",
      }).tool_choice,
    ).toBeUndefined();
  });
});
