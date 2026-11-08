/**
 * In-memory ring buffer of client-signal decisions for console + admin lookup.
 * Process-local only (lost on restart).
 */

import type { KnownClient } from "./clientSignal";

export type ClientSignalLogOutcome =
  | "allowed"
  /** Unlisted client allowed because the account is on Plus or above. */
  | "plan_allowed"
  /** Free/Go on an unlisted client: rejected with a plan notice, not banned. */
  | "missing_rejected"
  | "legacy_update_required"
  | "enforcement_disabled"
  | "already_banned"
  | "silent_rule_banned";

export type ClientSignalLogEntry = {
  id: string;
  at: string;
  userId: string;
  /** Redacted fingerprint only (never the full secret). */
  apiKey: string | null;
  path: string;
  method: string;
  client: KnownClient | null;
  allowed: boolean;
  outcome: ClientSignalLogOutcome;
  headers: Record<string, string | null>;
};

export type ClientSignalLogQuery = {
  userId?: string;
  apiKey?: string;
  client?: string;
  outcome?: string;
  path?: string;
  allowed?: boolean;
  limit?: number;
};

const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_QUERY_LIMIT = 200;
const MAX_QUERY_LIMIT = 1_000;

let seq = 0;
const entries: ClientSignalLogEntry[] = [];

/**
 * Allowed requests can be very frequent. Set
 * CLIENT_SIGNAL_ALLOWED_LOG_ENABLED=false to keep recording every decision in
 * the ring buffer while suppressing only the noisy non-blocking console logs.
 * Error/blocking outcomes continue to be logged.
 */
function isAllowedConsoleLogEnabled(): boolean {
  const raw = process.env.CLIENT_SIGNAL_ALLOWED_LOG_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function shouldConsoleLog(entry: ClientSignalLogEntry): boolean {
  if (entry.outcome === "allowed" || entry.outcome === "enforcement_disabled") {
    return isAllowedConsoleLogEnabled();
  }
  return true;
}

function maxEntries(): number {
  const raw = process.env.CLIENT_SIGNAL_LOG_MAX;
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ENTRIES;
  return Math.min(n, 50_000);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_QUERY_LIMIT);
}

/**
 * Record a client-signal decision: keep every entry in the ring buffer and
 * console-log it unless the allowed-log switch suppresses this non-blocking
 * outcome.
 */
export function recordClientSignalLog(
  input: Omit<ClientSignalLogEntry, "id" | "at" | "apiKey"> & {
    at?: string;
    apiKey?: string | null;
  },
): ClientSignalLogEntry {
  const entry: ClientSignalLogEntry = {
    id: `${Date.now()}-${++seq}`,
    at: input.at ?? new Date().toISOString(),
    userId: input.userId,
    apiKey: input.apiKey ?? null,
    path: input.path,
    method: input.method,
    client: input.client,
    allowed: input.allowed,
    outcome: input.outcome,
    headers: input.headers,
  };

  entries.push(entry);
  const cap = maxEntries();
  if (entries.length > cap) {
    entries.splice(0, entries.length - cap);
  }

  if (shouldConsoleLog(entry)) {
    const keyPart =
      entry.apiKey && process.env.NODE_ENV !== "production"
        ? ` key=${entry.apiKey}`
        : "";
    console.log(
      `[ClientSignal] ${entry.outcome} client=${entry.client ?? "none"} user=${entry.userId}${keyPart} ${entry.method} ${entry.path}`,
      entry.headers,
    );
  }

  return entry;
}

/**
 * Query recent logs (newest first). All filters are case-insensitive substring
 * matches except `allowed` / exact `outcome` / exact `client` when provided.
 * `apiKey` matches the redacted fingerprint, not the raw secret.
 */
export function queryClientSignalLogs(
  query: ClientSignalLogQuery = {},
): ClientSignalLogEntry[] {
  const limit = clampLimit(query.limit);
  const userId = query.userId?.trim().toLowerCase();
  const apiKey = query.apiKey?.trim().toLowerCase();
  const client = query.client?.trim().toLowerCase();
  const outcome = query.outcome?.trim().toLowerCase();
  const path = query.path?.trim().toLowerCase();
  const allowed = query.allowed;

  const matched: ClientSignalLogEntry[] = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;

    if (userId && !entry.userId.toLowerCase().includes(userId)) {
      continue;
    }
    if (apiKey && !(entry.apiKey ?? "").toLowerCase().includes(apiKey)) {
      continue;
    }
    if (client && (entry.client ?? "none") !== client) {
      continue;
    }
    if (outcome && entry.outcome !== outcome) {
      continue;
    }
    if (path && !entry.path.toLowerCase().includes(path)) {
      continue;
    }
    if (allowed !== undefined && entry.allowed !== allowed) {
      continue;
    }

    matched.push(entry);
    if (matched.length >= limit) {
      break;
    }
  }

  return matched;
}

export function getClientSignalLogStats(): {
  count: number;
  max: number;
} {
  return {
    count: entries.length,
    max: maxEntries(),
  };
}

/** Test helper: clear the in-memory buffer. */
export function clearClientSignalLogs(): void {
  entries.length = 0;
  seq = 0;
}
