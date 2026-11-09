import { useQuery } from "@tanstack/react-query";

export type ModelHealthStatus = "available" | "unavailable";

export type ModelHealthEntry = {
  model: string;
  provider: string;
  available: boolean;
  checkedAt: string;
};

export type ModelHealth = {
  /** Result of each probed model's own probe. */
  byModel: Record<string, ModelHealthStatus>;
  /**
   * Worst result among the probes of one model generation on a route (keyed by
   * {@link getModelFamilyKey}), for models that are not probed themselves.
   */
  byFamily: Record<string, ModelHealthStatus>;
  /** Worst result among a route's probes, for models with no probe in their generation. */
  byProvider: Record<string, ModelHealthStatus>;
};

type ModelHealthResponse = {
  models: ModelHealthEntry[];
};

/** Probes run every 5 minutes; older results mean the scheduler stopped, so show nothing. */
const STALE_AFTER_MS = 20 * 60 * 1000;

const EMPTY_MODEL_HEALTH: ModelHealth = { byModel: {}, byFamily: {}, byProvider: {} };

/**
 * A model's generation on its route: the id up to its major version, so
 * `gpt-6-sol`, `gpt-6.1-sol`, and `gpt-6-astra` share `gpt-6` while
 * `gpt-5.6-luna` is `gpt-5`. A model the upstream stops serving then fails only
 * its own generation instead of every model on the route.
 */
export function getModelFamilyKey(model: string, provider: string): string {
  const family = /^\D*\d+/.exec(model)?.[0] ?? model;
  return `${provider}:${family}`;
}

function combineWorst(
  statuses: Record<string, ModelHealthStatus>,
  key: string,
  status: ModelHealthStatus,
) {
  if (statuses[key] !== "unavailable") statuses[key] = status;
}

/**
 * One route (e.g. the Deni AI API) can have several probes. Combine them by the
 * worst result so a later probe never hides an earlier failure on that route.
 */
export function summarizeModelHealth(entries: ModelHealthEntry[], now = Date.now()): ModelHealth {
  const health: ModelHealth = { byModel: {}, byFamily: {}, byProvider: {} };
  for (const entry of entries) {
    if (now - new Date(entry.checkedAt).getTime() > STALE_AFTER_MS) continue;
    const status: ModelHealthStatus = entry.available ? "available" : "unavailable";
    health.byModel[entry.model] = status;
    combineWorst(health.byFamily, getModelFamilyKey(entry.model, entry.provider), status);
    combineWorst(health.byProvider, entry.provider, status);
  }
  return health;
}

/**
 * A probed model shows its own result; any other model shows its generation's
 * combined result on its route, or the route's when no probe covers that generation.
 */
export function getModelHealthStatus(
  health: ModelHealth,
  model: string,
  provider: string,
): ModelHealthStatus | undefined {
  return (
    health.byModel[model] ??
    health.byFamily[getModelFamilyKey(model, provider)] ??
    health.byProvider[provider]
  );
}

async function fetchModelHealth(): Promise<ModelHealth> {
  const response = await fetch("/api/status/models");
  if (!response.ok) throw new Error("Failed to load model status");
  const { models } = (await response.json()) as ModelHealthResponse;
  return summarizeModelHealth(models);
}

export function useModelHealth(enabled = true): ModelHealth {
  const query = useQuery({
    queryKey: ["model-health"],
    queryFn: fetchModelHealth,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
  });
  return query.data ?? EMPTY_MODEL_HEALTH;
}
