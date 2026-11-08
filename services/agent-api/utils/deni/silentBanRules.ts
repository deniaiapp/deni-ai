/**
 * Configurable silent-ban rules.
 *
 * When a request matches an enabled rule (UA / header / path / method conditions),
 * a per-user hit counter is incremented. After `hitsBeforeBan` matching requests
 * the user is banned from Flixa without any ban-specific wording in the API
 * response (same soft "service unavailable" surface as other Flixa bans).
 *
 * Rules and hit counters live in the Deni Postgres DB so they survive restarts
 * and stay consistent across instances.
 */

import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDeniDb } from "./db";
import { banUserFromFlixa } from "./ban";
import { summarizeClientHeaders } from "./clientSignal";
import { silentBanHit, silentBanRule } from "@deniai/db/flixa";

// ── Types ────────────────────────────────────────────────────────────────────

export type SilentBanMatchOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "regex"
  | "exists"
  | "not_exists";

export type SilentBanCondition = {
  /**
   * What to match against:
   * - `path`, `method`
   * - header name (e.g. `user-agent`, `x-client`)
   * - optional `header:` prefix (e.g. `header:user-agent`)
   */
  target: string;
  op: SilentBanMatchOp;
  /** Required for all ops except exists / not_exists. */
  value?: string;
  /** Default false (case-insensitive). Ignored for exists / not_exists. */
  caseSensitive?: boolean;
};

export type SilentBanRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** Matching requests required before ban. Minimum 1. */
  hitsBeforeBan: number;
  /** Stored as flixa_ban.reason when the ban fires. */
  reason: string;
  /** ALL conditions must match (AND). Empty = never matches. */
  conditions: SilentBanCondition[];
  createdAt: string;
  updatedAt: string;
};

export type SilentBanHit = {
  userId: string;
  ruleId: string;
  hitCount: number;
  firstHitAt: string;
  lastHitAt: string;
};

export type SilentBanEvalResult =
  | { action: "none" }
  // Rules or hit counters could not be read/written (DB error).
  | { action: "error" }
  | {
      action: "counted";
      ruleId: string;
      ruleName: string;
      hitCount: number;
      hitsBeforeBan: number;
    }
  | {
      action: "banned";
      ruleId: string;
      ruleName: string;
      hitCount: number;
      hitsBeforeBan: number;
      reason: string;
    };

export type CreateSilentBanRuleInput = {
  name: string;
  enabled?: boolean;
  hitsBeforeBan?: number;
  reason?: string;
  conditions: SilentBanCondition[];
};

export type UpdateSilentBanRuleInput = {
  name?: string;
  enabled?: boolean;
  hitsBeforeBan?: number;
  reason?: string;
  conditions?: SilentBanCondition[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const MATCH_OPS: ReadonlySet<string> = new Set([
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "regex",
  "exists",
  "not_exists",
]);

const MAX_RULES = 200;
const MAX_CONDITIONS = 20;
const MAX_NAME_LEN = 120;
const MAX_REASON_LEN = 200;
const MAX_TARGET_LEN = 120;
const MAX_VALUE_LEN = 500;
const MIN_HITS = 1;
const MAX_HITS = 10_000;
const DEFAULT_HITS_BEFORE_BAN = 3;
const RULES_CACHE_TTL_MS = 15_000;

// ── Rules cache ──────────────────────────────────────────────────────────────

let rulesCache: { rules: SilentBanRule[]; expiresAt: number } | null = null;
let rulesCacheInFlight: Promise<SilentBanRule[]> | null = null;
let rulesCacheGeneration = 0;

export function invalidateSilentBanRulesCache(): void {
  rulesCacheGeneration += 1;
  rulesCache = null;
  rulesCacheInFlight = null;
}

// ── Validation / mapping ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampHits(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HITS_BEFORE_BAN;
  return Math.min(MAX_HITS, Math.max(MIN_HITS, Math.floor(n)));
}

export function validateSilentBanCondition(
  raw: unknown,
  index: number,
): { ok: true; condition: SilentBanCondition } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: `conditions[${index}] must be an object` };
  }

  const target =
    typeof raw.target === "string" ? raw.target.trim() : "";
  if (!target || target.length > MAX_TARGET_LEN) {
    return {
      ok: false,
      error: `conditions[${index}].target is required (max ${MAX_TARGET_LEN} chars)`,
    };
  }

  const op = typeof raw.op === "string" ? raw.op.trim().toLowerCase() : "";
  if (!MATCH_OPS.has(op)) {
    return {
      ok: false,
      error: `conditions[${index}].op must be one of: ${[...MATCH_OPS].join(", ")}`,
    };
  }

  const needsValue = op !== "exists" && op !== "not_exists";
  let value: string | undefined;
  if (needsValue) {
    if (typeof raw.value !== "string" || raw.value.length === 0) {
      return {
        ok: false,
        error: `conditions[${index}].value is required for op=${op}`,
      };
    }
    if (raw.value.length > MAX_VALUE_LEN) {
      return {
        ok: false,
        error: `conditions[${index}].value max length is ${MAX_VALUE_LEN}`,
      };
    }
    value = raw.value;
    if (op === "regex") {
      try {
        void new RegExp(value, raw.caseSensitive === true ? "" : "i");
      } catch {
        return {
          ok: false,
          error: `conditions[${index}].value is not a valid regular expression`,
        };
      }
    }
  }

  return {
    ok: true,
    condition: {
      target,
      op: op as SilentBanMatchOp,
      ...(value !== undefined ? { value } : {}),
      caseSensitive: raw.caseSensitive === true,
    },
  };
}

export function validateSilentBanConditions(
  raw: unknown,
): { ok: true; conditions: SilentBanCondition[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "conditions must be an array" };
  }
  if (raw.length === 0) {
    return { ok: false, error: "conditions must include at least one condition" };
  }
  if (raw.length > MAX_CONDITIONS) {
    return {
      ok: false,
      error: `conditions max length is ${MAX_CONDITIONS}`,
    };
  }

  const conditions: SilentBanCondition[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = validateSilentBanCondition(raw[i], i);
    if (!result.ok) return result;
    conditions.push(result.condition);
  }
  return { ok: true, conditions };
}

type RuleRow = typeof silentBanRule.$inferSelect;

function parseConditionsJson(raw: unknown): SilentBanCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: SilentBanCondition[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = validateSilentBanCondition(raw[i], i);
    if (result.ok) out.push(result.condition);
  }
  return out;
}

function rowToRule(row: RuleRow): SilentBanRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    hitsBeforeBan: clampHits(row.hitsBeforeBan),
    reason: row.reason || "silent_ban_rule",
    conditions: parseConditionsJson(row.conditions),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Condition matching (pure, exported for tests) ────────────────────────────

/**
 * Resolve the string value for a condition target from the request context.
 * Returns `null` when the header / field is absent.
 */
export function resolveSilentBanTarget(
  target: string,
  headers: Headers,
  path: string,
  method: string,
): string | null {
  const t = target.trim().toLowerCase();
  if (t === "path") return path;
  if (t === "method") return method.toUpperCase();

  const headerName = t.startsWith("header:") ? t.slice("header:".length) : t;
  if (!headerName) return null;
  const value = headers.get(headerName);
  if (value === null) return null;
  return value;
}

export function matchSilentBanCondition(
  condition: SilentBanCondition,
  headers: Headers,
  path: string,
  method: string,
): boolean {
  const raw = resolveSilentBanTarget(condition.target, headers, path, method);
  const op = condition.op;

  if (op === "exists") return raw !== null && raw.length > 0;
  if (op === "not_exists") return raw === null || raw.length === 0;

  // Missing header: equals-style ops fail; not_* ops succeed for absence.
  if (raw === null) {
    return op === "not_contains" || op === "not_equals";
  }

  const caseSensitive = condition.caseSensitive === true;
  const left = caseSensitive ? raw : raw.toLowerCase();
  const rightRaw = condition.value ?? "";
  const right = caseSensitive ? rightRaw : rightRaw.toLowerCase();

  switch (op) {
    case "contains":
      return left.includes(right);
    case "not_contains":
      return !left.includes(right);
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "starts_with":
      return left.startsWith(right);
    case "ends_with":
      return left.endsWith(right);
    case "regex": {
      try {
        const re = new RegExp(rightRaw, caseSensitive ? "" : "i");
        return re.test(raw);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function matchSilentBanRule(
  rule: Pick<SilentBanRule, "conditions" | "enabled">,
  headers: Headers,
  path: string,
  method: string,
): boolean {
  if (!rule.enabled) return false;
  if (!rule.conditions.length) return false;
  return rule.conditions.every((c) =>
    matchSilentBanCondition(c, headers, path, method),
  );
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSilentBanRules(options?: {
  enabledOnly?: boolean;
}): Promise<SilentBanRule[]> {
  const rows = await getDeniDb()
    .select()
    .from(silentBanRule)
    .where(options?.enabledOnly ? eq(silentBanRule.enabled, true) : undefined)
    .orderBy(asc(silentBanRule.createdAt));
  return rows.map(rowToRule);
}

async function getEnabledRulesCached(): Promise<SilentBanRule[]> {
  if (rulesCache && rulesCache.expiresAt > Date.now()) {
    return rulesCache.rules;
  }

  if (rulesCacheInFlight) return rulesCacheInFlight;

  const generation = rulesCacheGeneration;
  const pending = listSilentBanRules({ enabledOnly: true }).then((rules) => {
    // A CRUD operation may invalidate the cache while the query is in flight.
    if (generation === rulesCacheGeneration) {
      rulesCache = {
        rules,
        expiresAt: Date.now() + RULES_CACHE_TTL_MS,
      };
    }
    return rules;
  });

  rulesCacheInFlight = pending;
  void pending.then(
    () => {
      if (rulesCacheInFlight === pending) rulesCacheInFlight = null;
    },
    () => {
      if (rulesCacheInFlight === pending) rulesCacheInFlight = null;
    },
  );

  return pending;
}

export async function getSilentBanRule(
  id: string,
): Promise<SilentBanRule | null> {
  const [row] = await getDeniDb()
    .select()
    .from(silentBanRule)
    .where(eq(silentBanRule.id, id))
    .limit(1);
  return row ? rowToRule(row) : null;
}

export async function createSilentBanRule(
  input: CreateSilentBanRuleInput,
): Promise<{ ok: true; rule: SilentBanRule } | { ok: false; error: string }> {
  const name = input.name?.trim() ?? "";
  if (!name || name.length > MAX_NAME_LEN) {
    return {
      ok: false,
      error: `name is required (max ${MAX_NAME_LEN} chars)`,
    };
  }

  const conditionsResult = validateSilentBanConditions(input.conditions);
  if (!conditionsResult.ok) return conditionsResult;

  const hitsBeforeBan = clampHits(
    input.hitsBeforeBan ?? DEFAULT_HITS_BEFORE_BAN,
  );
  const reason = (input.reason?.trim() || `silent_rule:${name}`).slice(
    0,
    MAX_REASON_LEN,
  );
  const enabled = input.enabled !== false;

  try {
    const db = getDeniDb();

    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(silentBanRule);
    if (n >= MAX_RULES) {
      return { ok: false, error: `Maximum of ${MAX_RULES} rules reached` };
    }

    const [row] = await db
      .insert(silentBanRule)
      .values({
        id: crypto.randomUUID(),
        name,
        enabled,
        hitsBeforeBan,
        reason,
        conditions: conditionsResult.conditions,
      })
      .returning();

    invalidateSilentBanRulesCache();
    return { ok: true, rule: rowToRule(row!) };
  } catch (error) {
    console.error("[SilentBan] Failed to create rule:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "create_failed",
    };
  }
}

export async function updateSilentBanRule(
  id: string,
  input: UpdateSilentBanRuleInput,
): Promise<{ ok: true; rule: SilentBanRule } | { ok: false; error: string }> {
  try {
    const existing = await getSilentBanRule(id);
    if (!existing) {
      return { ok: false, error: "rule_not_found" };
    }

    const name =
      input.name !== undefined ? input.name.trim() : existing.name;
    if (!name || name.length > MAX_NAME_LEN) {
      return {
        ok: false,
        error: `name is required (max ${MAX_NAME_LEN} chars)`,
      };
    }

    let conditions = existing.conditions;
    if (input.conditions !== undefined) {
      const conditionsResult = validateSilentBanConditions(input.conditions);
      if (!conditionsResult.ok) return conditionsResult;
      conditions = conditionsResult.conditions;
    }

    const hitsBeforeBan =
      input.hitsBeforeBan !== undefined
        ? clampHits(input.hitsBeforeBan)
        : existing.hitsBeforeBan;
    const reason =
      input.reason !== undefined
        ? (input.reason.trim() || existing.reason).slice(0, MAX_REASON_LEN)
        : existing.reason;
    const enabled =
      input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled;

    const [row] = await getDeniDb()
      .update(silentBanRule)
      .set({ name, enabled, hitsBeforeBan, reason, conditions, updatedAt: sql`NOW()` })
      .where(eq(silentBanRule.id, id))
      .returning();

    if (!row) {
      return { ok: false, error: "rule_not_found" };
    }

    invalidateSilentBanRulesCache();
    return { ok: true, rule: rowToRule(row) };
  } catch (error) {
    console.error(`[SilentBan] Failed to update rule=${id}:`, error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "update_failed",
    };
  }
}

export async function deleteSilentBanRule(
  id: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  try {
    const deleted = await getDeniDb()
      .delete(silentBanRule)
      .where(eq(silentBanRule.id, id))
      .returning({ id: silentBanRule.id });
    invalidateSilentBanRulesCache();
    return { ok: true, deleted: deleted.length > 0 };
  } catch (error) {
    console.error(`[SilentBan] Failed to delete rule=${id}:`, error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "delete_failed",
    };
  }
}

// ── Hits ─────────────────────────────────────────────────────────────────────

function rowToHit(row: typeof silentBanHit.$inferSelect): SilentBanHit {
  return {
    userId: row.userId,
    ruleId: row.ruleId,
    hitCount: row.hitCount,
    firstHitAt: row.firstHitAt.toISOString(),
    lastHitAt: row.lastHitAt.toISOString(),
  };
}

/**
 * Atomically increment the hit counter for (user, rule). Returns the new count.
 */
async function incrementSilentBanHit(
  userId: string,
  ruleId: string,
): Promise<number> {
  const [row] = await getDeniDb()
    .insert(silentBanHit)
    .values({ userId, ruleId, hitCount: 1 })
    .onConflictDoUpdate({
      target: [silentBanHit.userId, silentBanHit.ruleId],
      set: { hitCount: sql`${silentBanHit.hitCount} + 1`, lastHitAt: sql`NOW()` },
    })
    .returning({ hitCount: silentBanHit.hitCount });
  return row?.hitCount || 1;
}

function hitFilter(options: { userId?: string; ruleId?: string }): SQL[] {
  const filters: SQL[] = [];
  if (options.userId?.trim()) filters.push(eq(silentBanHit.userId, options.userId.trim()));
  if (options.ruleId?.trim()) filters.push(eq(silentBanHit.ruleId, options.ruleId.trim()));
  return filters;
}

export async function listSilentBanHits(options?: {
  userId?: string;
  ruleId?: string;
  limit?: number;
}): Promise<SilentBanHit[]> {
  const limit = Math.min(
    Math.max(1, Math.floor(options?.limit ?? 200)),
    1000,
  );

  const rows = await getDeniDb()
    .select()
    .from(silentBanHit)
    .where(and(...hitFilter(options ?? {})))
    .orderBy(desc(silentBanHit.lastHitAt))
    .limit(limit);
  return rows.map(rowToHit);
}

export async function resetSilentBanHits(options: {
  userId?: string;
  ruleId?: string;
}): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  if (!options.userId?.trim() && !options.ruleId?.trim()) {
    return {
      ok: false,
      error: "userId and/or ruleId is required to reset hits",
    };
  }

  try {
    const deleted = await getDeniDb()
      .delete(silentBanHit)
      .where(and(...hitFilter(options)))
      .returning({ userId: silentBanHit.userId });
    return { ok: true, deleted: deleted.length };
  } catch (error) {
    console.error("[SilentBan] Failed to reset hits:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "reset_failed",
    };
  }
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate enabled silent-ban rules against the request.
 *
 * - Matching rules increment a per-user hit counter.
 * - When any rule reaches `hitsBeforeBan`, the user is banned and `action: "banned"` is returned.
 * - Until then, the request is allowed through (`action: "counted"` or `"none"`).
 * - Fail-closed on DB errors (`action: "error"`): otherwise a DB outage, or a
 *   flood that exhausts the pool, would let rule-matching clients through
 *   uncounted. The caller rejects the request like any other auth DB error.
 */
export async function evaluateSilentBanRules(
  userId: string,
  headers: Headers,
  path: string,
  method: string,
): Promise<SilentBanEvalResult> {
  try {
    const rules = await getEnabledRulesCached();
    if (rules.length === 0) {
      return { action: "none" };
    }

    let lastCounted: Extract<SilentBanEvalResult, { action: "counted" }> | null =
      null;

    for (const rule of rules) {
      if (!matchSilentBanRule(rule, headers, path, method)) {
        continue;
      }

      const hitCount = await incrementSilentBanHit(userId, rule.id);
      console.warn(
        `[SilentBan] hit rule=${rule.id} name=${JSON.stringify(rule.name)} ` +
          `user=${userId} count=${hitCount}/${rule.hitsBeforeBan} ` +
          `${method} ${path}`,
      );

      if (hitCount >= rule.hitsBeforeBan) {
        const clientHeaders = summarizeClientHeaders(headers);
        const reason = rule.reason || `silent_rule:${rule.name}`;
        await banUserFromFlixa(userId, reason, {
          ...clientHeaders,
          silent_rule_id: rule.id,
          silent_rule_name: rule.name,
          silent_hit_count: String(hitCount),
        });

        return {
          action: "banned",
          ruleId: rule.id,
          ruleName: rule.name,
          hitCount,
          hitsBeforeBan: rule.hitsBeforeBan,
          reason,
        };
      }

      lastCounted = {
        action: "counted",
        ruleId: rule.id,
        ruleName: rule.name,
        hitCount,
        hitsBeforeBan: rule.hitsBeforeBan,
      };
    }

    return lastCounted ?? { action: "none" };
  } catch (error) {
    console.error("[SilentBan] evaluate failed (fail-closed):", error);
    return { action: "error" };
  }
}
