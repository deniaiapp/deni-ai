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
  /** Worst result among a route's probes, for models that are not probed themselves. */
  byProvider: Record<string, ModelHealthStatus>;
};

type ModelHealthResponse = {
  models: ModelHealthEntry[];
};

/** Probes run every 5 minutes; older results mean the scheduler stopped, so show nothing. */
const STALE_AFTER_MS = 20 * 60 * 1000;

const EMPTY_MODEL_HEALTH: ModelHealth = { byModel: {}, byProvider: {} };

/**
 * One route (e.g. the Deni AI API) can have several probes. Combine them by the
 * worst result so a later probe never hides an earlier failure on that route.
 */
export function summarizeModelHealth(entries: ModelHealthEntry[], now = Date.now()): ModelHealth {
  const health: ModelHealth = { byModel: {}, byProvider: {} };
  for (const entry of entries) {
    if (now - new Date(entry.checkedAt).getTime() > STALE_AFTER_MS) continue;
    const status: ModelHealthStatus = entry.available ? "available" : "unavailable";
    health.byModel[entry.model] = status;
    if (health.byProvider[entry.provider] !== "unavailable") {
      health.byProvider[entry.provider] = status;
    }
  }
  return health;
}

/** A probed model shows its own result; any other model shows its route's combined result. */
export function getModelHealthStatus(
  health: ModelHealth,
  model: string,
  provider: string,
): ModelHealthStatus | undefined {
  return health.byModel[model] ?? health.byProvider[provider];
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
