import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { validateAgentApiKey } from "../middleware/validateAgentAuth";

function app(): Hono {
  const hono = new Hono();
  hono.post("/v1/agent/responses", validateAgentApiKey, (c) =>
    c.json({ ok: true }),
  );
  return hono;
}

describe("missing_api_key", () => {
  beforeEach(() => {
    delete Bun.env.FLIXA_AUTH_DISABLED;
  });

  test("tells Codex how to send env_key", async () => {
    const res = await app().request("/v1/agent/responses", {
      method: "POST",
      headers: {
        "user-agent": "codex_cli_rs/0.144.0",
        originator: "codex_cli_rs",
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("missing_api_key");
    expect(body.error.message).toContain("env_key");
    expect(body.error.message).toContain("requires_openai_auth = false");
    expect(body.error.message).toContain("http_headers");
  });

  test("tells Windows Codex TUI to pin Authorization in config.toml", async () => {
    const res = await app().request("/v1/agent/responses", {
      method: "POST",
      headers: {
        "user-agent":
          "codex-tui/0.149.1 (Windows 10.0.29639; x86_64) unknown (codex-tui; 0.149.1)",
        originator: "codex-tui",
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("http_headers");
    expect(body.error.message).toContain("Codex TUI");
  });

  test("keeps the Flixa extension message for first-party clients", async () => {
    const res = await app().request("/v1/agent/responses", {
      method: "POST",
      headers: { "x-flixa-client": "vscode/1.0" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Flixa extension");
  });
});
