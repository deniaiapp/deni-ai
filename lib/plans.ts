export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  tokens: number;
  browserMinutes: number;
  computerMinutes: number;
  teammates: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    tokens: 10_000_000,
    browserMinutes: 30,
    computerMinutes: 30,
    teammates: 5,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 20,
    tokens: 200_000_000,
    browserMinutes: 600,
    computerMinutes: 600,
    teammates: 25,
  },
};

export type UsageMetric = "tokens" | "browser" | "computer" | "teammates";

export class UsageLimitError extends Error {
  code = "usage_limit" as const;
  metric: UsageMetric;
  constructor(metric: UsageMetric, message: string) {
    super(message);
    this.name = "UsageLimitError";
    this.metric = metric;
  }
}

export function isUsageLimitError(error: unknown): error is UsageLimitError {
  return error instanceof UsageLimitError || (error as { code?: string }).code === "usage_limit";
}

export type UsageMeter = { used: number; limit: number };

export type UsageSnapshot = {
  plan: PlanId;
  planName: string;
  period: string;
  currentPeriodEnd: string | null;
  stripeConfigured: boolean;
  tokens: UsageMeter;
  browserMinutes: UsageMeter;
  computerMinutes: UsageMeter;
  teammates: UsageMeter;
};

export function formatTokenCount(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const n = abs / 1_000_000;
    return `${value < 0 ? "-" : ""}${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}M`;
  }
  if (abs >= 1_000) {
    const n = abs / 1_000;
    return `${value < 0 ? "-" : ""}${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}k`;
  }
  return String(value);
}
