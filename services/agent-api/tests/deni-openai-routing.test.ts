import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  convertResponsesInputContentToChat,
  getClient,
} from "../utils/agent";

const ENV_KEYS = ["DENI_AI_API_KEY", "DENI_AI_API_BASE_URL"] as const;
const previousEnv: Record<string, string | undefined> = {};

before(() => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  process.env.DENI_AI_API_KEY = "deni_test_key_0123456789";
  delete process.env.DENI_AI_API_BASE_URL;
});

after(() => {
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

    assert.equal(result.providerName, "deni-ai");
    assert.equal(result.client.baseURL, "https://api.deniai.app/v1");
    assert.equal(result.client.apiKey, "deni_test_key_0123456789");
  });

  test("requires DENI_AI_API_KEY", () => {
    delete process.env.DENI_AI_API_KEY;
    try {
      assert.deepEqual(getClient("openai/gpt-6-luna"), {
        error: "DENI_AI_API_KEY is required",
      });
    } finally {
      process.env.DENI_AI_API_KEY = "deni_test_key_0123456789";
    }
  });

  test("routes every other catalog provider to Deni AI API too", () => {
    for (const model of ["anthropic/claude-sonnet-5.5", "google/gemini-3.8-flash"]) {
      const result = getClient(model);
      if ("error" in result) throw new Error(result.error);
      assert.equal(result.type, "deni");
      assert.equal(result.providerName, "deni-ai");
    }
  });
});

test("converts Responses content parts to Chat Completions parts", () => {
  assert.deepEqual(
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
    [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "low" } },
        ],
      },
      { type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] },
      { type: "function_call_output", call_id: "call_1", output: "done" },
    ],
  );
});
