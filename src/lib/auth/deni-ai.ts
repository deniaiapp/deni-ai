import "@tanstack/react-start/server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/auth-schema";
import { isDeniTier, type DeniTier } from "../billing/plans";

/** better-auth provider id of the Deni AI account (genericOAuth in src/lib/auth/index.ts). */
export const DENI_AI_PROVIDER_ID = "deni-ai";

export type DeniRunCostMetric = "model" | "browser" | "computer";

/**
 * Deni AI's view of the user's monthly pool (GET/POST /api/integrations/deni-run/usage).
 * The pool is shared by Deni AI chat, Flixa, and Deni Run, so `usedUsd` covers all three.
 */
export type DeniRunUsage = {
  tier: DeniTier;
  periodEnd: string;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  breakdownUsd: Record<DeniRunCostMetric, number>;
  /** `usedUsd` by product: Deni AI chat, Flixa, and Deni Run. */
  poolUsd: { chat: number; flixa: number; run: number };
  manageUrl: string;
};

const LINK_CACHE_MS = 15_000;
const USAGE_CACHE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

const g = globalThis as typeof globalThis & {
  __deniAiLinks?: Map<string, { deniUserId: string | null; expiresAt: number }>;
  __deniAiUsage?: Map<string, { usage: DeniRunUsage; expiresAt: number }>;
  __deniAiPendingCost?: Map<string, number>;
};

const links = () => (g.__deniAiLinks ??= new Map());
const usageCache = () => (g.__deniAiUsage ??= new Map());
const pendingCost = () => (g.__deniAiPendingCost ??= new Map());

export function deniAiUrl() {
  return (process.env.DENI_AI_URL?.trim() || "https://deniai.app").replace(/\/+$/, "");
}

/** Sign-in with Deni AI is offered when the OAuth client is configured. */
export function deniAiSignInConfigured() {
  return Boolean(process.env.DENI_AI_CLIENT_ID?.trim() && process.env.DENI_AI_CLIENT_SECRET?.trim());
}

/** Usage is metered by Deni AI when the service secret is configured. */
export function deniAiUsageConfigured() {
  return Boolean(process.env.DENI_RUN_SERVICE_SECRET?.trim());
}

/** The user-facing message is fixed (and translated); the detail goes to `cause` for logs. */
export class DeniAiUnavailableError extends Error {
  constructor(message = "Deni AI is unavailable. Try again in a moment.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeniAiUnavailableError";
  }
}

/** The linked Deni AI account was deleted or is a guest: treat the user as unlinked. */
export class DeniAiAccountMissingError extends Error {
  constructor() {
    super("The linked Deni AI account is no longer available.");
    this.name = "DeniAiAccountMissingError";
  }
}

/** The Deni AI user id (OIDC `sub`) linked to this Deni Run user, if any. */
export async function getLinkedDeniAiUserId(userId: string): Promise<string | null> {
  const cached = links().get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.deniUserId;
  const [row] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, DENI_AI_PROVIDER_ID)))
    // The newest link wins if a user re-links after their old Deni AI account went away.
    .orderBy(desc(account.createdAt))
    .limit(1);
  const deniUserId = row?.accountId ?? null;
  links().set(userId, { deniUserId, expiresAt: Date.now() + LINK_CACHE_MS });
  return deniUserId;
}

export function forgetDeniAiLink(userId: string) {
  links().delete(userId);
}

function parseUsage(value: unknown): DeniRunUsage {
  const data = value as Partial<DeniRunUsage> | null;
  if (!data || !isDeniTier(data.tier) || typeof data.limitUsd !== "number" || typeof data.usedUsd !== "number") {
    throw new DeniAiUnavailableError(undefined, { cause: "Deni AI returned an invalid usage response." });
  }
  return {
    tier: data.tier,
    periodEnd: String(data.periodEnd ?? ""),
    limitUsd: data.limitUsd,
    usedUsd: data.usedUsd,
    remainingUsd: typeof data.remainingUsd === "number" ? data.remainingUsd : Math.max(0, data.limitUsd - data.usedUsd),
    breakdownUsd: {
      model: Number(data.breakdownUsd?.model ?? 0),
      browser: Number(data.breakdownUsd?.browser ?? 0),
      computer: Number(data.breakdownUsd?.computer ?? 0),
    },
    poolUsd: {
      chat: Number(data.poolUsd?.chat ?? 0),
      flixa: Number(data.poolUsd?.flixa ?? 0),
      // An older Deni AI reports Deni Run's own spend only.
      run: Number(
        data.poolUsd?.run ??
          (data.breakdownUsd?.model ?? 0) + (data.breakdownUsd?.browser ?? 0) + (data.breakdownUsd?.computer ?? 0),
      ),
    },
    manageUrl: typeof data.manageUrl === "string" ? data.manageUrl : `${deniAiUrl()}/settings/billing`,
  };
}

async function callUsageApi(init: { method: "GET"; deniUserId: string } | { method: "POST"; body: unknown }) {
  const url = new URL(`${deniAiUrl()}/api/integrations/deni-run/usage`);
  if (init.method === "GET") url.searchParams.set("userId", init.deniUserId);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${process.env.DENI_RUN_SERVICE_SECRET?.trim() ?? ""}`,
        ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DeniAiUnavailableError(undefined, { cause: error });
  }
  if (res.status === 403 || res.status === 404) throw new DeniAiAccountMissingError();
  if (!res.ok) throw new DeniAiUnavailableError(undefined, { cause: `Deni AI usage request failed (${res.status})` });
  return parseUsage(await res.json());
}

/** The cached budget, if a recent request left one; never calls Deni AI. */
export function cachedDeniRunUsage(deniUserId: string) {
  const cached = usageCache().get(deniUserId);
  return cached && cached.expiresAt > Date.now() ? cached.usage : undefined;
}

/** The user's Deni Run budget for this month, cached briefly to keep polling cheap. */
export async function fetchDeniRunUsage(deniUserId: string, opts?: { fresh?: boolean }) {
  const cached = usageCache().get(deniUserId);
  if (!opts?.fresh && cached && cached.expiresAt > Date.now()) return cached.usage;
  const usage = await callUsageApi({ method: "GET", deniUserId });
  usageCache().set(deniUserId, { usage, expiresAt: Date.now() + USAGE_CACHE_MS });
  return usage;
}

/**
 * Report incurred cost to Deni AI. Cost that cannot be delivered is kept and sent
 * with the next report for the same user and metric, so an outage delays rather
 * than drops it (for the life of this server process).
 */
export async function reportDeniRunCost(deniUserId: string, metric: DeniRunCostMetric, costUsd: number) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  const key = `${deniUserId}:${metric}`;
  // Take the pending cost out before sending, so a concurrent report cannot send it again.
  const total = (pendingCost().get(key) ?? 0) + costUsd;
  pendingCost().delete(key);
  let usage: DeniRunUsage;
  try {
    usage = await callUsageApi({ method: "POST", body: { userId: deniUserId, metric, costUsd: total } });
  } catch (error) {
    pendingCost().set(key, (pendingCost().get(key) ?? 0) + total);
    throw error;
  }
  usageCache().set(deniUserId, { usage, expiresAt: Date.now() + USAGE_CACHE_MS });
  return usage;
}
