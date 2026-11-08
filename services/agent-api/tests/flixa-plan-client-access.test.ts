import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

// Replace the DB-backed auth, ban, silent-ban and billing lookups before the
// middleware loads them. No external DB or keys.
type Tier = "free" | "go" | "plus" | "pro";
let tier: Tier | "throw" = "free";

const auth = await import("../utils/deni/auth");
const validateDeniApiKey = mock.fn(async (key: string) => ({
  valid: true as const,
  userId: `user-${key}`,
}));
mock.module("../utils/deni/auth", { exports: { ...auth, validateDeniApiKey } });

const ban = await import("../utils/deni/ban");
const isUserBannedFromFlixa = mock.fn(async (_userId: string) => false);
const banUserFromFlixa = mock.fn(async (..._args: unknown[]) => ({ success: true }));
mock.module("../utils/deni/ban", {
  exports: { ...ban, isUserBannedFromFlixa, banUserFromFlixa },
});

const silentBanRules = await import("../utils/deni/silentBanRules");
type SilentBanEvalResult = Awaited<ReturnType<typeof silentBanRules.evaluateSilentBanRules>>;
let silentBanResult: SilentBanEvalResult = { action: "none" };
const evaluateSilentBanRules = mock.fn(async () => silentBanResult);
mock.module("../utils/deni/silentBanRules", {
  exports: { ...silentBanRules, evaluateSilentBanRules },
});

const usage = await import("../utils/deni/usage");
const getDeniBillingProfile = mock.fn(async (_userId: string) => {
  if (tier === "throw") throw new Error("connection timeout");
  return { billing: null, isTeam: false, tier, hasVerifiedPaymentMethod: false };
});
const reserveUsageQuota = mock.fn(async () => ({
  allowed: true,
  remaining: 1_000_000,
  reserved: false,
  unit: usage.USAGE_UNIT,
}));
mock.module("../utils/deni/usage", {
  exports: { ...usage, getDeniBillingProfile, reserveUsageQuota },
});

const { BANNED_ERROR_MESSAGE, CLIENT_UPDATE_REQUIRED_MESSAGE, MISSING_CLIENT_SIGNAL_MESSAGE } = ban;
const { clearClientSignalLogs, queryClientSignalLogs } = await import(
  "../utils/deni/clientSignalLog"
);
const { validateAgentApiKey, validateAgentAuth } = await import(
  "../middleware/validateAgentAuth"
);

const UNKNOWN_UA = "my-external-app/2.0";
const AI_SDK_UA = "ai-sdk/openai-compatible/1.0.0";

let served = 0;
let keyCounter = 0;
function newKey(): string {
  keyCounter += 1;
  return `deni_plan_access_${keyCounter}`;
}

function modelsApp(): Hono {
  const app = new Hono();
  app.get("/v1/models", validateAgentApiKey, (c) => {
    served += 1;
    return c.json({ ok: true });
  });
  return app;
}

const setBody: MiddlewareHandler = async (c, next) => {
  c.set("validatedBody" as never, {
    model: "openai/gpt-6-luna",
    messages: [{ role: "user", content: "hi" }],
  } as never);
  await next();
};

function inferenceApp(): Hono {
  const app = new Hono();
  app.post("/v1/agent/chat/completions", setBody, validateAgentAuth, (c) => {
    served += 1;
    return c.json({ ok: true });
  });
  return app;
}

function request(app: Hono, path: string, key: string, userAgent: string, method = "GET") {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "user-agent": userAgent },
  });
}

beforeEach(() => {
  tier = "free";
  silentBanResult = { action: "none" };
  served = 0;
  isUserBannedFromFlixa.mock.mockImplementation(async () => false);
  banUserFromFlixa.mock.resetCalls();
  clearClientSignalLogs();
  delete process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
});

describe("client access by plan", () => {
  for (const paidTier of ["plus", "pro"] as const) {
    test(`serves ${paidTier} users from an unlisted client without banning`, async () => {
      tier = paidTier;
      const key = newKey();
      const res = await request(modelsApp(), "/v1/models", key, UNKNOWN_UA);
      assert.equal(res.status, 200);
      assert.equal(served, 1);
      assert.equal(banUserFromFlixa.mock.callCount(), 0);
      const [log] = queryClientSignalLogs({ userId: `user-${key}` });
      assert.equal(log?.outcome, "plan_allowed");
      assert.equal(log?.allowed, true);
      assert.equal(log?.client, null);
    });
  }

  test("serves Plus inference requests from an unlisted client", async () => {
    tier = "plus";
    const res = await request(
      inferenceApp(),
      "/v1/agent/chat/completions",
      newKey(),
      UNKNOWN_UA,
      "POST",
    );
    assert.equal(res.status, 200);
    assert.equal(served, 1);
    assert.equal(banUserFromFlixa.mock.callCount(), 0);
  });

  test("serves Plus users from AI SDK apps without asking them to update", async () => {
    tier = "plus";
    const res = await request(modelsApp(), "/v1/models", newKey(), AI_SDK_UA);
    assert.equal(res.status, 200);
    assert.equal(served, 1);
  });

  for (const freeTier of ["free", "go"] as const) {
    test(`rejects ${freeTier} users from an unlisted client with a plan notice, without banning`, async () => {
      tier = freeTier;
      const key = newKey();
      const res = await request(modelsApp(), "/v1/models", key, UNKNOWN_UA);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), {
        error: {
          message: MISSING_CLIENT_SIGNAL_MESSAGE,
          type: "insufficient_plan",
          param: null,
          code: "missing_client_signal",
          tier: freeTier,
          upgradeUrl: usage.getUpgradeUrl(),
        },
      });
      assert.equal(served, 0);
      assert.equal(banUserFromFlixa.mock.callCount(), 0);
      const [log] = queryClientSignalLogs({ userId: `user-${key}` });
      assert.equal(log?.outcome, "missing_rejected");
    });
  }

  test("still asks Go users on the AI SDK to update without banning", async () => {
    tier = "go";
    const res = await request(modelsApp(), "/v1/models", newKey(), AI_SDK_UA);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "client_update_required");
    assert.equal(body.error.message, CLIENT_UPDATE_REQUIRED_MESSAGE);
    assert.equal(banUserFromFlixa.mock.callCount(), 0);
  });

  test("serves Free users from an allowed client without a billing lookup", async () => {
    getDeniBillingProfile.mock.resetCalls();
    const res = await request(modelsApp(), "/v1/models", newKey(), "codex_cli_rs/0.144.0");
    assert.equal(res.status, 200);
    assert.equal(getDeniBillingProfile.mock.callCount(), 0);
  });

  test("fails closed with 503 and no ban when the billing lookup errors", async () => {
    tier = "throw";
    const res = await request(modelsApp(), "/v1/models", newKey(), UNKNOWN_UA);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {
      error: {
        message: "Database error during validation",
        type: "server_error",
        param: null,
        code: "db_error",
      },
    });
    assert.equal(served, 0);
    assert.equal(banUserFromFlixa.mock.callCount(), 0);
  });

  test("still rejects banned Plus users", async () => {
    tier = "plus";
    isUserBannedFromFlixa.mock.mockImplementation(async () => true);
    const res = await request(modelsApp(), "/v1/models", newKey(), UNKNOWN_UA);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "service_unavailable");
    assert.equal(body.error.message, BANNED_ERROR_MESSAGE);
    assert.equal(served, 0);
  });

  test("still applies silent-ban rules to Plus users", async () => {
    tier = "plus";
    silentBanResult = { action: "banned" } as SilentBanEvalResult;
    const key = newKey();
    const res = await request(modelsApp(), "/v1/models", key, UNKNOWN_UA);
    assert.equal(res.status, 403);
    assert.equal(served, 0);
    const [log] = queryClientSignalLogs({ userId: `user-${key}` });
    assert.equal(log?.outcome, "silent_rule_banned");
  });
});
