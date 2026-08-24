import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { accessLog } from "../middleware/accessLog";
import { logErrorResponses } from "../middleware/logErrorResponses";

const rawKey = "deni_abcdefghijklmnopqrstuvwxyz012345";

afterEach(() => {
  delete Bun.env.FLIXA_AUTH_DISABLED;
});

describe("accessLog", () => {
  test("logs a redacted API key fingerprint, not the secret", async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const app = new Hono();
    app.use("*", accessLog);
    app.get("/v1/ping", (c) => c.json({ ok: true }));

    try {
      const res = await app.request("/v1/ping", {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      expect(res.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    const outgoing = lines.find((line) => line.startsWith("--> GET /v1/ping"));
    expect(outgoing).toBeDefined();
    expect(outgoing).toContain("key=deni_abc…2345");
    expect(outgoing).not.toContain(rawKey);
  });
});

describe("logErrorResponses", () => {
  test("includes redacted apiKey on HTTP errors", async () => {
    const payloads: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      payloads.push(args[1]);
    };

    const app = new Hono();
    app.use("*", logErrorResponses);
    app.get("/v1/fail", (c) =>
      c.json({ error: { message: "nope", code: "invalid_key" } }, 401),
    );

    try {
      const res = await app.request("/v1/fail", {
        headers: { "x-api-key": rawKey },
      });
      expect(res.status).toBe(401);
    } finally {
      console.error = originalError;
    }

    const payload = payloads.find(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
    expect(payload?.apiKey).toBe("deni_abc…2345");
    expect(JSON.stringify(payload)).not.toContain(rawKey);
  });
});
