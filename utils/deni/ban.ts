import { getDeniPool } from "./db";
import { invalidateUserAuthCache } from "./auth";

export type BanReason = "missing_client_signal" | "manual" | string;

export type BanResult =
  | { banned: true; alreadyBanned: boolean }
  | { banned: false; error: string };

let tableReady: Promise<void> | null = null;

/**
 * Ensure the flixa_ban table exists. Idempotent; runs at most once per process.
 */
async function ensureBanTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const pool = getDeniPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS flixa_ban (
          user_id TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          client_headers JSONB,
          banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS flixa_ban_banned_at_idx
        ON flixa_ban (banned_at DESC)
      `);
    })().catch((error) => {
      // Allow retry on next call if the first attempt failed (e.g. cold start race).
      tableReady = null;
      throw error;
    });
  }

  await tableReady;
}

const banStatusCache = new Map<string, { banned: boolean; expiresAt: number }>();
const BAN_CACHE_TTL_MS = 30_000;
const BAN_CACHE_MAX_ENTRIES = 10_000;

function getCachedBanStatus(userId: string): boolean | null {
  const entry = banStatusCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    banStatusCache.delete(userId);
    return null;
  }
  return entry.banned;
}

function setCachedBanStatus(userId: string, banned: boolean): void {
  if (banStatusCache.size >= BAN_CACHE_MAX_ENTRIES) {
    banStatusCache.clear();
  }
  banStatusCache.set(userId, {
    banned,
    expiresAt: Date.now() + BAN_CACHE_TTL_MS,
  });
}

export function invalidateBanCache(userId?: string): void {
  if (userId) {
    banStatusCache.delete(userId);
    return;
  }
  banStatusCache.clear();
}

/**
 * Check whether a user is banned from Flixa.
 */
export async function isUserBannedFromFlixa(userId: string): Promise<boolean> {
  const cached = getCachedBanStatus(userId);
  if (cached !== null) {
    return cached;
  }

  try {
    await ensureBanTable();
    const pool = getDeniPool();
    const result = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM flixa_ban WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const banned = result.rows.length > 0;
    setCachedBanStatus(userId, banned);
    return banned;
  } catch (error) {
    console.error("[Ban] Failed to check ban status:", error);
    // Fail closed for ban checks only after a positive cache miss is dangerous;
    // prefer fail-open on DB errors so a flixa_ban outage does not lock everyone out.
    return false;
  }
}

/**
 * Ban a user from Flixa:
 * 1. Record the ban
 * 2. Revoke all of their API keys
 * 3. Invalidate auth / ban caches
 */
export async function banUserFromFlixa(
  userId: string,
  reason: BanReason,
  clientHeaders?: Record<string, string | null>,
): Promise<BanResult> {
  try {
    await ensureBanTable();
    const pool = getDeniPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const insert = await client.query(
        `INSERT INTO flixa_ban (user_id, reason, client_headers, banned_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id`,
        [userId, reason, JSON.stringify(clientHeaders ?? null)],
      );

      const alreadyBanned = (insert.rowCount ?? 0) === 0;

      // Always revoke keys so a re-issued key cannot bypass a prior ban
      // without an explicit unban + new login flow.
      const revoked = await client.query(
        `DELETE FROM api_key WHERE user_id = $1`,
        [userId],
      );

      await client.query("COMMIT");

      invalidateUserAuthCache(userId);
      setCachedBanStatus(userId, true);

      console.warn(
        `[Ban] user=${userId} reason=${reason} alreadyBanned=${alreadyBanned} revokedKeys=${revoked.rowCount ?? 0}`,
        clientHeaders ? { clientHeaders } : undefined,
      );

      return { banned: true, alreadyBanned };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`[Ban] Failed to ban user=${userId}:`, error);
    return {
      banned: false,
      error: error instanceof Error ? error.message : "ban_failed",
    };
  }
}

export type UnbanResult =
  | { unbanned: true; userId: string; wasBanned: boolean }
  | { unbanned: false; error: string };

/**
 * Remove a Flixa ban for a user. Does not re-issue API keys —
 * the user must log in to Deni AI again to create a new key.
 */
export async function unbanUserFromFlixa(userId: string): Promise<UnbanResult> {
  try {
    await ensureBanTable();
    const pool = getDeniPool();
    const result = await pool.query<{ user_id: string }>(
      `DELETE FROM flixa_ban WHERE user_id = $1 RETURNING user_id`,
      [userId],
    );

    const wasBanned = (result.rowCount ?? 0) > 0;
    invalidateUserAuthCache(userId);
    setCachedBanStatus(userId, false);

    console.warn(`[Ban] unban user=${userId} wasBanned=${wasBanned}`);
    return { unbanned: true, userId, wasBanned };
  } catch (error) {
    console.error(`[Ban] Failed to unban user=${userId}:`, error);
    return {
      unbanned: false,
      error: error instanceof Error ? error.message : "unban_failed",
    };
  }
}

/**
 * Look up a Deni user by email (case-insensitive) and remove their Flixa ban.
 */
export async function unbanUserFromFlixaByEmail(
  email: string,
): Promise<
  | { unbanned: true; userId: string; email: string; wasBanned: boolean }
  | { unbanned: false; error: string; code: "user_not_found" | "unban_failed" }
> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { unbanned: false, error: "Email is required", code: "user_not_found" };
  }

  try {
    const pool = getDeniPool();
    const userResult = await pool.query<{ id: string; email: string | null }>(
      `SELECT id, email FROM "user" WHERE lower(email) = $1 LIMIT 1`,
      [normalizedEmail],
    );

    if (userResult.rows.length === 0) {
      return {
        unbanned: false,
        error: `No user found with email: ${normalizedEmail}`,
        code: "user_not_found",
      };
    }

    const user = userResult.rows[0];
    const result = await unbanUserFromFlixa(user.id);
    if (!result.unbanned) {
      return {
        unbanned: false,
        error: result.error,
        code: "unban_failed",
      };
    }

    return {
      unbanned: true,
      userId: result.userId,
      email: user.email ?? normalizedEmail,
      wasBanned: result.wasBanned,
    };
  } catch (error) {
    console.error(`[Ban] Failed to unban by email=${normalizedEmail}:`, error);
    return {
      unbanned: false,
      error: error instanceof Error ? error.message : "unban_failed",
      code: "unban_failed",
    };
  }
}

/** Public message when a user is blocked from Flixa (do not mention ban). */
export const BANNED_ERROR_MESSAGE =
  "Deni AI Flixa is currently unavailable. Please contact us at contact@deniai.app.";

export const MISSING_CLIENT_SIGNAL_MESSAGE =
  "Unauthorized client. Deni AI API keys may only be used from Codex, Claude Code, OpenCode, or Flixa. Your account has been banned from Flixa.";

/** Soft-reject for legacy AI SDK / outdated Flixa clients (no ban). */
export const CLIENT_UPDATE_REQUIRED_MESSAGE =
  "Please update your Deni AI Flixa to continue.";
