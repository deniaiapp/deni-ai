import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { Hono } from "hono";
import { accessLog } from "../middleware/accessLog";
import { logErrorResponses } from "../middleware/logErrorResponses";

const rawKey = "deni_abcdefghijklmnopqrstuvwxyz012345";

afterEach(() => {
  delete process.env.FLIXA_AUTH_DISABLED;
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
      assert.equal(res.status, 200);
    } finally {
      console.log = originalLog;
    }

    const outgoing = lines.find((line) => line.startsWith("--> GET /v1/ping"));
    assert.notEqual(outgoing, undefined);
    assert.ok(outgoing!.includes("key=deni_abc…2345"));
    assert.ok(!outgoing!.includes(rawKey));
  });

  test("omits the API key fingerprint in production", async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    const originalNodeEnv = process.env.NODE_ENV;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    process.env.NODE_ENV = "production";

    const app = new Hono();
    app.use("*", accessLog);
    app.get("/v1/ping", (c) => c.json({ ok: true }));

    try {
      const res = await app.request("/v1/ping", {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      assert.equal(res.status, 200);
    } finally {
      console.log = originalLog;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }

    const outgoing = lines.find((line) => line.startsWith("--> GET /v1/ping"));
    assert.notEqual(outgoing, undefined);
    assert.ok(!outgoing!.includes("key="));
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
      assert.equal(res.status, 401);
    } finally {
      console.error = originalError;
    }

    const payload = payloads.find(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
    assert.equal(payload?.apiKey, "deni_abc…2345");
    assert.partialDeepStrictEqual(payload?.auth, {
      hasAuthorization: false,
      hasXApiKey: true,
    });
    assert.ok(Array.isArray(payload?.headerNames) && payload.headerNames.includes("x-api-key"));
    assert.ok(!JSON.stringify(payload).includes(rawKey));
  });
});
