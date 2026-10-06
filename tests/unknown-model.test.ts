import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { validateAgentAuth } from "../middleware/validateAgentAuth";

let previous: string | undefined;

beforeAll(() => {
  previous = Bun.env.FLIXA_AUTH_DISABLED;
  Bun.env.FLIXA_AUTH_DISABLED = "true";
});

afterAll(() => {
  if (previous === undefined) delete Bun.env.FLIXA_AUTH_DISABLED;
  else Bun.env.FLIXA_AUTH_DISABLED = previous;
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
  test.each(["openai/gpt-5.5", "anthropic/claude-opus-4.8", "google/gemini-3-pro-preview", "made-up"])(
    "%s is rejected with 404 model_not_found",
    async (model) => {
      const response = await appFor(model).request("/", { method: "POST" });
      const body = (await response.json()) as { error: { code: string } };

      expect(response.status).toBe(404);
      expect(body.error.code).toBe("model_not_found");
    },
  );

  test("registered models pass the model check", async () => {
    const response = await appFor("openai/gpt-6-luna").request("/", { method: "POST" });

    expect(response.status).toBe(200);
  });
});
