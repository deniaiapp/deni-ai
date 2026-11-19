import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { format } from "node:util";
import { Hono } from "hono";
import { validateAgentAuth } from "../middleware/validateAgentAuth";

let previous: string | undefined;

before(() => {
  previous = process.env.FLIXA_AUTH_DISABLED;
  process.env.FLIXA_AUTH_DISABLED = "true";
});

after(() => {
  if (previous === undefined) delete process.env.FLIXA_AUTH_DISABLED;
  else process.env.FLIXA_AUTH_DISABLED = previous;
});

function appFor(model: string) {
  const app = new Hono<{ Variables: { validatedBody: { model: string } } }>();
  app.use("*", async (c, next) => {
    c.set("validatedBody", { model });
    await next();
  });
  app.post("/", validateAgentAuth, (c) => c.json({ ok: true }));
  return app;
}

describe("unlisted models", () => {
  for (const model of ["openai/gpt-5.5", "anthropic/claude-opus-4.8", "google/gemini-3-pro-preview", "made-up"]) {
    test(format("%s is rejected with 404 model_not_found", model), async () => {
      const response = await appFor(model).request("/", { method: "POST" });
      const body = (await response.json()) as { error: { code: string } };

      assert.equal(response.status, 404);
      assert.equal(body.error.code, "model_not_found");
    });
  }

  test("registered models pass the model check", async () => {
    const response = await appFor("openai/gpt-6-luna").request("/", { method: "POST" });

    assert.equal(response.status, 200);
  });
});
