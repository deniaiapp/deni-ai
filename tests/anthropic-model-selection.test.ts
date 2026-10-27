import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { format } from "node:util";
import { Hono } from "hono";
import { validateAnthropicRequest } from "../middleware/validateAnthropicRequest";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();
app.post("/messages", validateAnthropicRequest, (c) => c.json(c.get("validatedBody")));

const baseBody = {
  model: "claude-sonnet-4.6",
  max_tokens: 64,
  messages: [{ role: "user", content: "hi" }],
};

async function send(extra: Record<string, unknown>) {
  const response = await app.request("/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseBody, ...extra }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe("anthropic messages model selection", () => {
  test("drops body fields that pick other models and keeps the rest", async () => {
    const { status, body } = await send({
      fallbacks: [{ model: "openai/gpt-5.5" }],
      models: ["openai/gpt-5.5"],
      preset: "@preset/expensive",
      route: "fallback",
      temperature: 0.2,
      metadata: { user_id: "u1" },
      stop_sequences: ["END"],
      thinking: { type: "enabled", budget_tokens: 1024 },
    });

    assert.equal(status, 200);
    assert.equal(body.fallbacks, undefined);
    assert.equal(body.models, undefined);
    assert.equal(body.preset, undefined);
    assert.equal(body.route, undefined);
    assert.equal(body.model, "claude-sonnet-4.6");
    assert.equal(body.max_tokens, 64);
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(body.metadata, { user_id: "u1" });
    assert.deepEqual(body.stop_sequences, ["END"]);
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 1024 });
  });

  test("filters plugins by id, keeping only ones that select no model", async () => {
    const kept = [
      { id: "web", max_results: 3 },
      { id: "web-fetch" },
      { id: "file-parser", pdf: { engine: "pdf-text" } },
      { id: "response-healing" },
      { id: "moderation" },
      { id: "context-compression", engine: "middle-out" },
    ];
    const { status, body } = await send({
      plugins: [
        ...kept,
        { id: "auto-router", allowed_models: ["openai/*"] },
        { id: "auto-beta-router" },
        { id: "pareto-router", min_coding_score: 0.9 },
        { id: "fusion", model: "openai/gpt-5.5", analysis_models: ["openai/gpt-5.5"] },
        { id: "some-future-plugin" },
        { enabled: true },
        "web",
      ],
    });

    assert.equal(status, 200);
    assert.deepEqual(body.plugins, kept);
  });

  test("leaves plugins absent when the client sent none", async () => {
    const { status, body } = await send({});

    assert.equal(status, 200);
    assert.equal("plugins" in body, false);
  });

  test("accepts custom, Anthropic built-in and non-model OpenRouter tools", async () => {
    const tools = [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" }, model: { type: "string" } },
        },
      },
      { type: "custom", name: "grep", input_schema: { type: "object" } },
      { type: "bash_20250124", name: "bash" },
      { type: "text_editor_20250124", name: "str_replace_editor" },
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      { type: "openrouter:datetime", parameters: { timezone: "UTC" } },
      { type: "openrouter:web_search", parameters: { engine: "exa", max_results: 5 } },
      { type: "openrouter:web_fetch", parameters: { max_uses: 2 } },
      { type: "openrouter:experimental__search_models", parameters: { max_results: 5 } },
    ];
    const { status, body } = await send({ tools });

    assert.equal(status, 200);
    assert.deepEqual(body.tools, tools);
  });

  for (const tool of [
    { type: "advisor_20260301", name: "advisor", model: "claude-opus-4-8" },
    { type: "openrouter:advisor", parameters: { model: "openai/gpt-5.5" } },
    { type: "openrouter:advisor" },
    { type: "openrouter:fusion", parameters: { analysis_models: ["openai/gpt-5.5"] } },
    { type: "openrouter:subagent", parameters: { model: "openai/gpt-5.5" } },
    { type: "openrouter:image_generation", parameters: { model: "openai/gpt-image-1" } },
    { type: "openrouter:some_future_tool" },
    { type: "OpenRouter:advisor" },
    { type: "openrouter:bash" },
    { type: "openrouter:shell", parameters: { engine: "openrouter" } },
    { type: "openrouter:apply_patch" },
    { type: "openrouter:files" },
    { type: "openrouter:web_search", parameters: { model: "openai/gpt-5.5" } },
    { name: "lookup", model: "openai/gpt-5.5", input_schema: { type: "object" } },
  ]) {
    test(format("rejects tool that selects a model or uses shared storage: %j", tool), async () => {
      const { status, body } = await send({
        tools: [{ name: "read_file", input_schema: { type: "object" } }, tool],
      });

      assert.equal(status, 400);
      assert.equal(body.error.type, "invalid_request_error");
      assert.equal(body.error.param, "tools[1]");
      assert.equal(body.error.code, "invalid_tool");
    });
  }
});
