import { describe, expect, test } from "vitest";
import {
  ALL_FLIXA_ERROR_CODES,
  anthropicMessagesRequestSchema,
  anthropicModelsResponseSchema,
  apiKeyLimitReachedErrorSchema,
  apiKeySchema,
  chatCompletionsRequestSchema,
  deniUsageInfoSchema,
  deniUsageResponseSchema,
  deviceAuthErrorSchema,
  deviceAuthInitiateResponseSchema,
  deviceAuthPollResponseSchema,
  deviceAuthRequestSchema,
  flixaCliClientHeaders,
  flixaErrorEnvelopeSchema,
  getApiKeyDisplayPrefix,
  insufficientPlanErrorSchema,
  isApiKey,
  modelsResponseSchema,
  quotaExceededErrorSchema,
  rateLimitErrorSchema,
  responsesCompactRequestSchema,
  responsesRequestSchema,
} from "./index.js";

// Bodies below are copies of what the servers answer (apps/web device-auth
// route, services/agent-api routes and middleware), with made-up ids.
const API_KEY = "deni_0123456789abcdef0123456789abcdef01234567";

describe("API keys", () => {
  test("format", () => {
    expect(isApiKey(API_KEY)).toBe(true);
    expect(apiKeySchema.safeParse(API_KEY).success).toBe(true);
    expect(isApiKey("deni_0123")).toBe(false);
    expect(isApiKey(`sk_${API_KEY.slice(5)}`)).toBe(false);
    expect(isApiKey(API_KEY.toUpperCase().replace("DENI_", "deni_"))).toBe(false);
    expect(getApiKeyDisplayPrefix(API_KEY)).toBe("deni_01234567");
  });
});

describe("device auth", () => {
  test("requests", () => {
    expect(deviceAuthRequestSchema.parse({ action: "initiate" })).toEqual({ action: "initiate" });
    expect(
      deviceAuthRequestSchema.safeParse({ action: "approve", userCode: "ABCD-EFGH" }).success,
    ).toBe(true);
    // I, O, 0 and 1 are not in the user-code alphabet.
    expect(
      deviceAuthRequestSchema.safeParse({ action: "approve", userCode: "ABCD-EFG1" }).success,
    ).toBe(false);
    expect(
      deviceAuthRequestSchema.safeParse({ action: "poll", deviceCode: "a".repeat(64) }).success,
    ).toBe(true);
    expect(deviceAuthRequestSchema.safeParse({ action: "logout" }).success).toBe(false);
  });

  test("initiate response", () => {
    expect(
      deviceAuthInitiateResponseSchema.parse({
        userCode: "K7QX-9MZP",
        deviceCode: "0f".repeat(32),
        expiresIn: 900,
      }),
    ).toBeTruthy();
  });

  test("poll responses", () => {
    for (const body of [
      { approved: false },
      { approved: true, apiKey: API_KEY, apiKeyId: "7f0c2f4e-5b44-4a8b-9a55-9b2c3d0f1e2a" },
      { approved: true, apiKeyUnavailable: true },
    ]) {
      expect(deviceAuthPollResponseSchema.parse(body)).toEqual(body);
    }
    expect(deviceAuthPollResponseSchema.safeParse({ approved: true }).success).toBe(false);
  });

  test("errors", () => {
    const limit = {
      code: "API_KEY_LIMIT_REACHED",
      error: "Maximum of 5 API keys allowed. Revoke an existing key first.",
      apiKeys: [
        {
          id: "k1",
          name: "Flixa Extension",
          keyPrefix: "deni_01234567",
          lastUsedAt: null,
          createdAt: "2026-10-01T09:00:00.000Z",
        },
        {
          id: "k2",
          name: "CLI",
          keyPrefix: "deni_89abcdef",
          lastUsedAt: "2026-11-02T10:11:12.000Z",
          createdAt: "2026-10-02T09:00:00.000Z",
        },
      ],
    };
    expect(apiKeyLimitReachedErrorSchema.parse(limit)).toEqual(limit);
    expect(deviceAuthErrorSchema.parse(limit)).toEqual(limit);
    expect(deviceAuthErrorSchema.parse({ error: "Code expired" })).toEqual({
      error: "Code expired",
    });
    expect(
      deviceAuthErrorSchema.parse({
        error:
          "Guest accounts cannot authorize the Flixa extension. Please sign in with an account.",
        reason: "anonymous_forbidden",
      }).reason,
    ).toBe("anonymous_forbidden");
  });
});

describe("errors", () => {
  test("envelope with upstream identifiers", () => {
    expect(
      flixaErrorEnvelopeSchema.parse({
        error: {
          message: "Invalid request",
          type: "invalid_request_error",
          param: null,
          code: "context_length_exceeded",
        },
      }),
    ).toBeTruthy();
    expect(
      flixaErrorEnvelopeSchema.parse({
        error: { message: "Internal server error", type: "server_error", param: null, code: null },
      }),
    ).toBeTruthy();
    expect(flixaErrorEnvelopeSchema.safeParse({ error: "nope" }).success).toBe(false);
  });

  test("quota exceeded", () => {
    const body = {
      error: {
        message:
          "Insufficient monthly usage left to reserve this request (120000 estimated usage units). Please upgrade your plan or wait for the usage reset.",
        type: "quota_exceeded",
        param: null,
        code: "USAGE_LIMIT_EXCEEDED",
        category: "basic",
        tier: "free",
        canVerifyForBoost: true,
        canUpgrade: true,
        verifyUrl: "https://deniai.app/settings/billing",
        upgradeUrl: "https://deniai.app/settings/billing",
      },
    };
    expect(quotaExceededErrorSchema.parse(body)).toEqual(body);
    expect(flixaErrorEnvelopeSchema.parse(body).error.tier).toBe("free");
  });

  test("plan restrictions", () => {
    expect(
      insufficientPlanErrorSchema.parse({
        error: {
          message: "This app is not available on your plan.",
          type: "insufficient_plan",
          param: null,
          code: "missing_client_signal",
          tier: "go",
          upgradeUrl: "https://deniai.app/settings/billing",
        },
      }),
    ).toBeTruthy();
    expect(
      insufficientPlanErrorSchema.parse({
        error: {
          message: 'The model "openai/gpt-6-astra" requires a pro plan or higher.',
          type: "insufficient_plan",
          param: "model",
          code: "tier_restricted",
        },
      }),
    ).toBeTruthy();
  });

  test("rate limit", () => {
    expect(
      rateLimitErrorSchema.parse({
        error: {
          message: "Too many requests",
          type: "rate_limit_error",
          param: null,
          code: "rate_limit_exceeded",
        },
      }),
    ).toBeTruthy();
  });

  test("codes are unique", () => {
    expect(new Set(ALL_FLIXA_ERROR_CODES).size).toBe(ALL_FLIXA_ERROR_CODES.length);
  });
});

describe("models", () => {
  test("GET /v1/models", () => {
    const body = [
      {
        id: "openai/gpt-6-luna",
        usageTier: 3,
        label: "GPT-6 Luna",
        description: "Balanced OpenAI model.",
        tags: ["general", "reasoning"],
        efforts: ["low", "medium", "high", "xhigh", "max"],
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        longContextThreshold: 272_000,
        longContextUsageMultiplier: 2,
        tier: "free",
        premium: false,
        tokenUsageMultiplier: 2,
        default: true,
      },
      {
        id: "anthropic/claude-sonnet-5.5",
        usageTier: 2,
        freeTierUsageTier: 2,
        label: "Claude Sonnet 5.5",
        description: "Anthropic model.",
        tags: ["general"],
        efforts: ["low", "medium", "high", "xhigh", "max"],
        tier: "free",
        premium: false,
        tokenUsageMultiplier: 1.5,
        default: false,
      },
    ];
    expect(modelsResponseSchema.parse(body)).toEqual(body);
    expect(modelsResponseSchema.safeParse([{ ...body[0], usageTier: 11 }]).success).toBe(false);
  });

  test("Anthropic variant", () => {
    const flag = { supported: true };
    const body = {
      data: [
        {
          type: "model",
          id: "claude-sonnet-5-5",
          display_name: "Claude Sonnet 5.5",
          created_at: "2026-09-28T00:00:00Z",
          max_input_tokens: 1000000,
          max_tokens: 128000,
          capabilities: {
            batch: flag,
            citations: flag,
            code_execution: flag,
            context_management: {
              supported: true,
              clear_tool_uses_20250919: flag,
              clear_thinking_20251015: flag,
              compact_20260112: flag,
            },
            effort: {
              supported: true,
              low: flag,
              medium: flag,
              high: flag,
              xhigh: flag,
              max: flag,
            },
            image_input: flag,
            pdf_input: flag,
            structured_outputs: flag,
            thinking: { supported: true, types: { enabled: flag, adaptive: flag } },
          },
        },
      ],
      has_more: false,
      first_id: "claude-sonnet-5-5",
      last_id: "claude-sonnet-5-5",
    };
    expect(anthropicModelsResponseSchema.parse(body)).toEqual(body);
  });
});

describe("usage", () => {
  const info = {
    tier: "go",
    hasVerifiedPaymentMethod: false,
    cardVerifiedAt: null,
    verifyUrl: "https://deniai.app/settings/billing",
    upgradeUrl: "https://deniai.app/settings/billing",
    isTeam: false,
    planId: "go_monthly",
    status: "active",
    periodEnd: "2026-12-01T00:00:00.000Z",
    maxModeEnabled: false,
    maxModeEligible: false,
    usage: (["basic", "premium"] as const).map((category) => ({
      category,
      unit: "units",
      limit: 60_000_000,
      used: 1_250_000,
      remaining: 58_750_000,
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-12-01T00:00:00.000Z",
    })),
    pool: {
      limit: 60_000_000,
      used: 1_250_000,
      remaining: 58_750_000,
      periodEnd: "2026-12-01T00:00:00.000Z",
    },
  };

  test("GET /v1/deni/usage", () => {
    expect(deniUsageInfoSchema.parse(info)).toEqual(info);
    expect(deniUsageResponseSchema.parse(info)).toEqual(info);
  });

  test("auth-disabled servers omit the pool", () => {
    const { pool: _pool, ...withoutPool } = info;
    expect(deniUsageInfoSchema.safeParse(withoutPool).success).toBe(false);
    expect(deniUsageResponseSchema.safeParse(withoutPool).success).toBe(true);
  });
});

describe("requests", () => {
  test("chat completions", () => {
    expect(
      chatCompletionsRequestSchema.safeParse({
        model: "openai/gpt-6-luna",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
          { role: "assistant", tool_calls: [] },
          { role: "tool", tool_call_id: "call_1", content: "{}" },
        ],
        temperature: 0.2,
        tools: [{ type: "function", function: { name: "read_file", parameters: {} } }],
        user: "passthrough-field",
      }).success,
    ).toBe(true);
    expect(
      chatCompletionsRequestSchema.safeParse({
        model: "m",
        messages: [{ role: "tool", content: "{}" }],
      }).success,
    ).toBe(false);
    expect(
      chatCompletionsRequestSchema.safeParse({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        temperature: 3,
      }).success,
    ).toBe(false);
  });

  test("responses", () => {
    expect(
      responsesRequestSchema.safeParse({
        model: "gpt-5.6",
        input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
        instructions: "You are Codex.",
        stream: true,
        store: false,
        reasoning: { effort: "high", summary: "auto" },
        text: { verbosity: "low", format: { type: "json_schema", name: "out", schema: {} } },
        tools: [{ type: "function", name: "shell", parameters: {} }, { type: "web_search" }],
        tool_choice: "auto",
        include: ["reasoning.encrypted_content"],
        prompt_cache_key: "session-1",
        context_management: [{ type: "compaction", compact_threshold: 200000 }],
      }).success,
    ).toBe(true);
    expect(responsesRequestSchema.safeParse({ model: "gpt-5.6" }).success).toBe(false);
    expect(
      responsesRequestSchema.safeParse({
        model: "gpt-5.6",
        input: "x",
        text: { format: { type: "json_schema", schema: {} } },
      }).success,
    ).toBe(false);
    expect(
      responsesCompactRequestSchema.safeParse({ model: "gpt-5.6", previous_response_id: "resp_1" })
        .success,
    ).toBe(true);
    expect(responsesCompactRequestSchema.safeParse({ model: "gpt-5.6" }).success).toBe(false);
  });

  test("anthropic messages", () => {
    expect(
      anthropicMessagesRequestSchema.safeParse({
        model: "claude-sonnet-5-5",
        max_tokens: 1024,
        system: "Be brief.",
        messages: [
          { role: "developer", content: "Extra system text" },
          { role: "user", content: [{ type: "text", text: "Hi" }] },
        ],
      }).success,
    ).toBe(true);
    expect(
      anthropicMessagesRequestSchema.safeParse({
        model: "claude-sonnet-5-5",
        messages: [{ role: "system", content: "only system" }],
      }).success,
    ).toBe(false);
  });
});

test("first-party client headers", () => {
  expect(flixaCliClientHeaders("1.2.3")).toEqual({
    "user-agent": "flixa-cli/1.2.3",
    "x-client": "flixa-cli",
    "x-flixa-client": "cli/1.2.3",
    originator: "flixa-cli",
  });
});
