import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { env } from "@/env";
import { models } from "@deniai/ai/models";
import { createDeniOpenRouter } from "@deniai/ai/openrouter";

const PROBE_TIMEOUT_MS = 30_000;
const MAX_ERROR_LENGTH = 300;
const DEFAULT_PROBE_INTERVAL_MS = 5 * 60 * 1000;
/** How long past its next due probe a result is still shown, so a stopped scheduler shows nothing. */
const STALE_GRACE_MS = 15 * 60 * 1000;
/** A quota error that names no retry time is probed again after this long. */
const QUOTA_FALLBACK_RETRY_MS = 60 * 60 * 1000;
const MAX_QUOTA_RETRY_MS = 24 * 60 * 60 * 1000;

type HealthCheckModel = { value: string; intervalMs?: number };

/**
 * Catalog models probed by the scheduler: OpenAI models on the Deni AI API, others
 * on OpenRouter. Every probe is a real generation request, so it spends the
 * provider's quota. Google AI Studio counts its free-tier quota per model, and
 * Gemini 3.8 Flash gets only 20 requests a day there, shared with users' chats:
 * probing it every 5 minutes used the day's quota soon after each reset. So
 * Gemini 3.5 Flash-Lite stands in for the Google route; models not probed
 * themselves, 3.8 Flash among them, show their generation's result (`gemini-3`),
 * and a Flash-Lite probe every 30 minutes keeps its own quota for users.
 */
export const HEALTH_CHECK_MODELS = [
  { value: "gpt-6-luna" },
  { value: "gemini-3.5-flash-lite", intervalMs: 30 * 60 * 1000 },
  { value: "claude-haiku-5.5" },
] as const satisfies readonly HealthCheckModel[];

export const HEALTH_CHECK_MODEL_VALUES = HEALTH_CHECK_MODELS.map((model) => model.value);

export type ModelHealthResult = {
  model: string;
  provider: string;
  available: boolean;
  latencyMs: number | null;
  error: string | null;
  /** Set when the provider refused for quota: wait this long before probing again. */
  retryAfterMs?: number;
};

function probeIntervalMs(value: string): number {
  const model: HealthCheckModel | undefined = HEALTH_CHECK_MODELS.find(
    (candidate) => candidate.value === value,
  );
  return model?.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
}

const QUOTA_ERROR = /exceeded your current quota|quota exceeded|resource[_ ]exhausted/i;
const RETRY_IN = /retry in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i;

/**
 * For a quota refusal, how long to wait before probing again: the retry time the
 * provider names (Google AI Studio says e.g. "Please retry in 22h4m22.5s" once the
 * daily quota is used), else an hour. Probing again sooner cannot succeed.
 */
export function quotaRetryDelayMs(message: string): number | null {
  if (!QUOTA_ERROR.test(message)) return null;
  const match = RETRY_IN.exec(message);
  if (!match || !(match[1] || match[2] || match[3])) return QUOTA_FALLBACK_RETRY_MS;
  const ms =
    (Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000;
  return Math.min(Math.ceil(ms), MAX_QUOTA_RETRY_MS);
}

function getProbeProvider(value: string) {
  const definition = models.find((candidate) => candidate.value === value);
  if (!definition) throw new Error(`Unknown model: ${value}`);
  return {
    provider: definition.provider ?? definition.author,
    modelId: `${definition.author}/${definition.value}`,
  };
}

function createProbeModel(provider: string, modelId: string): LanguageModel {
  if (provider === "deni") {
    const apiKey = env.DENI_API_KEY?.trim();
    if (!apiKey) throw new Error("Deni AI API is not configured");
    return createOpenAI({ apiKey, baseURL: env.DENI_API_BASE_URL }).chat(modelId);
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenRouter is not configured");
  return createDeniOpenRouter({ apiKey }).chat(modelId, {
    provider: {
      allow_fallbacks: false,
      only: ["openai", "anthropic", "google-ai-studio"],
    },
  });
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export async function probeModel(value: string): Promise<ModelHealthResult> {
  const startedAt = Date.now();
  let provider = "unknown";
  try {
    const probe = getProbeProvider(value);
    provider = probe.provider;
    await generateText({
      model: createProbeModel(probe.provider, probe.modelId),
      prompt: "ping",
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      model: value,
      provider,
      available: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    const retryAfterMs = quotaRetryDelayMs(error instanceof Error ? error.message : String(error));
    return {
      model: value,
      provider,
      available: false,
      latencyMs: Date.now() - startedAt,
      error: describeError(error),
      ...(retryAfterMs === null ? {} : { retryAfterMs }),
    };
  }
}

export type ModelHealthRecord = Omit<ModelHealthResult, "retryAfterMs"> & {
  checkedAt: Date;
  /** When the scheduler probes this model next. */
  nextCheckAt: Date;
  /** After this the result is too old to show (the scheduler stopped). */
  staleAt: Date;
};

const globalForModelHealth = globalThis as typeof globalThis & {
  modelHealthResults?: Map<string, ModelHealthRecord>;
};

/**
 * Latest result per probed model, kept in this server's memory: each replica
 * probes on its own, and keeping them out of the database lets it suspend.
 */
function modelHealthResults() {
  return (globalForModelHealth.modelHealthResults ??= new Map());
}

export function recordModelHealth(result: ModelHealthResult, checkedAt = new Date()) {
  const { retryAfterMs, ...rest } = result;
  const intervalMs = probeIntervalMs(result.model);
  const waitMs = retryAfterMs === undefined ? intervalMs : Math.max(retryAfterMs, intervalMs);
  const nextCheckAt = new Date(checkedAt.getTime() + waitMs);
  modelHealthResults().set(result.model, {
    ...rest,
    checkedAt,
    nextCheckAt,
    staleAt: new Date(nextCheckAt.getTime() + STALE_GRACE_MS),
  });
}

/** Models whose next probe is due: never probed here, or past their `nextCheckAt`. */
export function dueHealthCheckModels(now = Date.now()): string[] {
  const results = modelHealthResults();
  return HEALTH_CHECK_MODEL_VALUES.filter((value) => {
    const record = results.get(value);
    return !record || record.nextCheckAt.getTime() <= now;
  });
}

/** Probes the models that are due and records their results. */
export async function checkModelHealth(): Promise<ModelHealthResult[]> {
  const results = await Promise.all(dueHealthCheckModels().map(probeModel));
  for (const result of results) recordModelHealth(result);
  return results;
}

export function getModelHealth(): ModelHealthRecord[] {
  const rows = [...modelHealthResults().values()];
  const order = new Map<string, number>(HEALTH_CHECK_MODEL_VALUES.map((value, i) => [value, i]));
  return rows
    .filter((row) => order.has(row.model))
    .sort((a, b) => (order.get(a.model) ?? 0) - (order.get(b.model) ?? 0));
}
