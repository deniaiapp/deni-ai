import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { format } from "node:util";
import { Hono } from "hono";
import {
  validateResponsesCompactRequest,
  validateResponsesRequest,
} from "../middleware/validateRequest";

const app = new Hono<{ Variables: { validatedBody: Record<string, unknown> } }>();
app.post("/responses", validateResponsesRequest, (c) => c.json(c.get("validatedBody")));
app.post("/responses/compact", validateResponsesCompactRequest, (c) =>
  c.json(c.get("validatedBody")),
);

const OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5";
const DENI_MODEL = "openai/gpt-6-sol";

async function send(path: string, body: Record<string, unknown>) {
  const response = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

function responses(model: string, extra: Record<string, unknown>) {
  return send("/responses", { model, input: "hi", ...extra });
}

const functionTool = {
  type: "function",
  name: "read_file",
  parameters: { type: "object", properties: { model: { type: "string" } } },
};

const blockedEverywhere = [
  { type: "openrouter:advisor", parameters: { model: "openai/gpt-6-sol" } },
  { type: "openrouter:advisor" },
  { type: "OpenRouter:advisor" },
  { type: "openrouter:subagent", parameters: { model: "openai/gpt-6-sol" } },
  { type: "openrouter:fusion", parameters: { analysis_models: ["openai/gpt-6-sol"] } },
  { type: "openrouter:image_generation", parameters: { model: "openai/gpt-image-1" } },
  { type: "openrouter:some_future_tool" },
  { type: "openrouter:bash" },
  { type: "openrouter:shell", parameters: { engine: "openrouter" } },
  { type: "openrouter:apply_patch" },
  { type: "openrouter:files" },
];

const blockedOnOpenRouterOnly = [
  { type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5" },
  { type: "image_generation", model: "gpt-image-1" },
  { type: "image_generation" },
  { type: "code_interpreter", container: { type: "auto" } },
  { type: "some_future_tool" },
  { type: "openrouter:web_search", parameters: { model: "openai/gpt-6-sol" } },
  { type: "web_search", model: "openai/gpt-6-sol" },
];

const allowedOnOpenRouter = [
  functionTool,
  { type: "custom", name: "apply_patch", format: { type: "text" } },
  { type: "local_shell" },
  { type: "web_search" },
  { type: "web_search_preview" },
  { type: "namespace", name: "mcp", tools: [functionTool] },
  { type: "openrouter:datetime", parameters: { timezone: "UTC" } },
  { type: "openrouter:web_search", parameters: { engine: "exa", max_results: 5 } },
  { type: "openrouter:web_fetch", parameters: { max_uses: 2 } },
  { type: "openrouter:experimental__search_models", parameters: { max_results: 5 } },
];

describe("responses server tool policy", () => {
  test("accepts function, client and non-model OpenRouter tools on OpenRouter", async () => {
    const { status, body } = await responses(OPENROUTER_MODEL, { tools: allowedOnOpenRouter });

    assert.equal(status, 200);
    assert.deepEqual(body.tools, allowedOnOpenRouter);
  });

  for (const tool of blockedEverywhere) {
    test(format("rejects %j on OpenRouter and Deni routes", tool), async () => {
      for (const model of [OPENROUTER_MODEL, DENI_MODEL, "gpt-6-sol"]) {
        const { status, body } = await responses(model, { tools: [functionTool, tool] });

        assert.equal(status, 400);
        assert.equal(body.error.param, "tools[1]");
        assert.equal(body.error.code, "invalid_tool");
      }
    });
  }

  for (const tool of blockedOnOpenRouterOnly) {
    test(format("rejects %j on OpenRouter only", tool), async () => {
      const rejected = await responses(OPENROUTER_MODEL, { tools: [functionTool, tool] });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.param, "tools[1]");
      assert.equal(rejected.body.error.code, "invalid_tool");

      const accepted = await responses(DENI_MODEL, { tools: [functionTool, tool] });
      assert.equal(accepted.status, 200);
    });
  }

  test("checks tools nested in a namespace", async () => {
    const { status, body } = await responses(OPENROUTER_MODEL, {
      tools: [{ type: "namespace", name: "x", tools: [functionTool, { type: "openrouter:advisor" }] }],
    });

    assert.equal(status, 400);
    assert.equal(body.error.param, "tools[0].tools[1]");
  });

  test("checks tool_choice, including allowed_tools lists", async () => {
    const direct = await responses(OPENROUTER_MODEL, {
      tools: [functionTool],
      tool_choice: { type: "openrouter:subagent" },
    });
    assert.equal(direct.status, 400);
    assert.equal(direct.body.error.param, "tool_choice");

    const allowedTools = await responses(OPENROUTER_MODEL, {
      tools: [functionTool],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "read_file" }, { type: "image_generation" }],
      },
    });
    assert.equal(allowedTools.status, 400);
    assert.equal(allowedTools.body.error.param, "tool_choice.tools[1]");

    const ok = await responses(OPENROUTER_MODEL, {
      tools: [functionTool],
      tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "read_file" }] },
    });
    assert.equal(ok.status, 200);
  });

  test("checks tools declared by additional_tools input items, nested or not", async () => {
    for (const path of ["/responses", "/responses/compact"]) {
      const flat = await send(path, {
        model: OPENROUTER_MODEL,
        input: [
          { type: "message", role: "user", content: "hi" },
          { type: "additional_tools", tools: [{ type: "openrouter:advisor" }] },
        ],
      });
      assert.equal(flat.status, 400);
      assert.equal(flat.body.error.param, "input[1].tools[0]");

      const nested = await send(path, {
        model: OPENROUTER_MODEL,
        input: [
          [{ type: "message", role: "user", content: "hi" }],
          [[{ type: "additional_tools", tools: [functionTool, { type: "openrouter:files" }] }]],
        ],
      });
      assert.equal(nested.status, 400);
      assert.equal(nested.body.error.param, "input[1].tools[1]");

      const ok = await send(path, {
        model: OPENROUTER_MODEL,
        input: [
          { type: "message", role: "user", content: "hi" },
          { type: "additional_tools", tools: [functionTool] },
        ],
      });
      assert.equal(ok.status, 200);
    }
  });

  test("keeps Deni-routed image_generation and advisor tools working", async () => {
    const tools = [
      { type: "image_generation", model: "gpt-image-1" },
      { type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5" },
    ];
    const { status, body } = await responses(DENI_MODEL, {
      tools,
      input: [{ type: "additional_tools", tools }],
    });

    assert.equal(status, 200);
    assert.deepEqual(body.tools, tools);
  });
});
