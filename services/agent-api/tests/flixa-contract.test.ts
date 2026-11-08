import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  anthropicModelsResponseSchema,
  deniUsageResponseSchema,
  flixaErrorEnvelopeSchema,
  modelsResponseSchema,
} from "@deniai/flixa-contract";
import { Hono } from "hono";
import { validateAgentApiKey } from "../middleware/validateAgentAuth";
import { validateAgentRequest, validateResponsesRequest } from "../middleware/validateRequest";
import { validateAnthropicRequest } from "../middleware/validateAnthropicRequest";
import { deniRouter } from "../routes/v1/deni";
import { modelsRouter } from "../routes/v1/models";
import { listModelDefinitions } from "../utils/agent/models";

// The public response shapes are published as @deniai/flixa-contract; these
// tests parse what this server actually answers with those schemas.
function app(): Hono {
  const hono = new Hono();
  hono.route("/v1", modelsRouter);
  hono.route("/v1", deniRouter);
  hono.post("/v1/agent/chat/completions", validateAgentRequest, (c) => c.json({ ok: true }));
  hono.post("/v1/agent/responses", validateResponsesRequest, (c) => c.json({ ok: true }));
  hono.post("/v1/messages", validateAnthropicRequest, (c) => c.json({ ok: true }));
  hono.post("/v1/agent/keyed", validateAgentApiKey, (c) => c.json({ ok: true }));
  return hono;
}

describe("flixa contract: auth-disabled routes", () => {
  const previous = process.env.FLIXA_AUTH_DISABLED;
  before(() => {
    process.env.FLIXA_AUTH_DISABLED = "true";
  });
  after(() => {
    if (previous === undefined) delete process.env.FLIXA_AUTH_DISABLED;
    else process.env.FLIXA_AUTH_DISABLED = previous;
  });

  test("model definitions", () => {
    modelsResponseSchema.parse(listModelDefinitions());
  });

  test("GET /v1/models and /v1/agent/models", async () => {
    for (const path of ["/v1/models", "/v1/agent/models"]) {
      const res = await app().request(path);
      assert.equal(res.status, 200);
      const models = modelsResponseSchema.parse(await res.json());
      assert.equal(models.filter((model) => model.default).length, 1);
    }
  });

  test("GET /v1/models with Anthropic headers", async () => {
    const res = await app().request("/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    assert.equal(res.status, 200);
    const body = anthropicModelsResponseSchema.parse(await res.json());
    assert.equal(body.first_id, body.data[0]?.id ?? null);
  });

  test("GET /v1/deni/usage", async () => {
    const res = await app().request("/v1/deni/usage");
    assert.equal(res.status, 200);
    const body = deniUsageResponseSchema.parse(await res.json());
    assert.equal(body.tier, "pro");
  });
});

describe("flixa contract: error envelopes", () => {
  const previous = process.env.FLIXA_AUTH_DISABLED;
  before(() => {
    delete process.env.FLIXA_AUTH_DISABLED;
  });
  after(() => {
    if (previous !== undefined) process.env.FLIXA_AUTH_DISABLED = previous;
  });

  const cases: Array<[string, RequestInit, number, string]> = [
    ["/v1/agent/chat/completions", { method: "POST", body: "{" }, 400, "invalid_json"],
    [
      "/v1/agent/chat/completions",
      { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) },
      400,
      "missing_messages",
    ],
    [
      "/v1/agent/responses",
      { method: "POST", body: JSON.stringify({ model: "m" }) },
      400,
      "missing_input",
    ],
    [
      "/v1/messages",
      { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) },
      400,
      "missing_model",
    ],
    ["/v1/agent/keyed", { method: "POST" }, 401, "missing_api_key"],
    ["/v1/deni/usage", {}, 401, "missing_auth_header"],
  ];

  for (const [path, init, status, code] of cases) {
    test(`${path} -> ${code}`, async () => {
      const res = await app().request(path, init);
      assert.equal(res.status, status);
      const body = flixaErrorEnvelopeSchema.parse(await res.json());
      assert.equal(body.error.code, code);
    });
  }
});
