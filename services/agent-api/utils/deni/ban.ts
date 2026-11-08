import { eq, sql } from "drizzle-orm";
import { getDeniDb } from "./db";
import { invalidateUserAuthCache } from "./auth";
import { apiKey, user } from "@deniai/db";
import { ban } from "@deniai/db/flixa";

export type BanReason = "missing_client_signal" | "manual" | string;

export type BanResult =
  | { banned: true; alreadyBanned: boolean }
  | { banned: false; error: string };

const banStatusCache = new Map<string, { banned: boolean; expiresAt: number }>();
const banStatusInFlight = new Map<string, Promise<boolean>>();
const BAN_CACHE_TTL_MS = 30_000;
const BAN_CACHE_MAX_ENTRIES = 10_000;
let banCacheGeneration = 0;

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
  banCacheGeneration += 1;
  if (userId) {
    banStatusCache.delete(userId);
    banStatusInFlight.delete(userId);
    return;
  }
  banStatusCache.clear();
  banStatusInFlight.clear();
}

/**
 * Check whether a user is banned from Flixa.
 *
 * Throws when the ban status cannot be determined (e.g. DB error) so callers
 * fail closed instead of treating an unknown status as "not banned".
 */
export async function isUserBannedFromFlixa(userId: string): Promise<boolean> {
  const cached = getCachedBanStatus(userId);
  if (cached !== null) {
    return cached;
  }

  const existing = banStatusInFlight.get(userId);
  if (existing) return existing;

  const generation = banCacheGeneration;
  const pending = (async () => {
    try {
      const rows = await getDeniDb()
        .select({ userId: ban.userId })
        .from(ban)
        .where(eq(ban.userId, userId))
        .limit(1);
      const banned = rows.length > 0;
      // An admin ban/unban can invalidate the cache while this query is in
      // flight. Do not let the older result overwrite the newer state.
      if (generation === banCacheGeneration) {
        setCachedBanStatus(userId, banned);
      }
      return banned;
    } catch (error) {
      console.error("[Ban] Failed to check ban status:", error);
      // Fail closed: an unknown status must not let a banned user through.
      // Not cached, so the next request retries the lookup.
      throw error;
    }
  })();

  banStatusInFlight.set(userId, pending);
  void pending.then(
    () => {
      if (banStatusInFlight.get(userId) === pending) {
        banStatusInFlight.delete(userId);
      }
    },
    () => {
      if (banStatusInFlight.get(userId) === pending) {
        banStatusInFlight.delete(userId);
      }
    },
  );

  return pending;
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
    const { alreadyBanned, revokedKeys } = await getDeniDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(ban)
        .values({ userId, reason, clientHeaders: clientHeaders ?? null })
        .onConflictDoNothing({ target: ban.userId })
        .returning({ userId: ban.userId });

      // Always revoke keys so a re-issued key cannot bypass a prior ban
      // without an explicit unban + new login flow.
      const revoked = await tx
        .delete(apiKey)
        .where(eq(apiKey.userId, userId))
        .returning({ id: apiKey.id });

      return { alreadyBanned: inserted.length === 0, revokedKeys: revoked.length };
    });

    invalidateUserAuthCache(userId);
    setCachedBanStatus(userId, true);

    console.warn(
      `[Ban] user=${userId} reason=${reason} alreadyBanned=${alreadyBanned} revokedKeys=${revokedKeys}`,
      clientHeaders ? { clientHeaders } : undefined,
    );

    return { banned: true, alreadyBanned };
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
    const deleted = await getDeniDb()
      .delete(ban)
      .where(eq(ban.userId, userId))
      .returning({ userId: ban.userId });

    const wasBanned = deleted.length > 0;
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

async function findUserByEmail(
  email: string,
): Promise<
  | { found: true; userId: string; email: string }
  | { found: false; error: string }
> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { found: false, error: "Email is required" };
  }

  const [found] = await getDeniDb()
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalizedEmail))
    .limit(1);

  if (!found) {
    return {
      found: false,
      error: `No user found with email: ${normalizedEmail}`,
    };
  }

  return {
    found: true,
    userId: found.id,
    email: found.email,
  };
}

/**
 * Look up a Deni user by email (case-insensitive) and ban them from Flixa.
 * Revokes all API keys for that user.
 */
export async function banUserFromFlixaByEmail(
  email: string,
  reason: BanReason = "manual",
  clientHeaders?: Record<string, string | null>,
): Promise<
  | {
      banned: true;
      userId: string;
      email: string;
      alreadyBanned: boolean;
      reason: BanReason;
    }
  | { banned: false; error: string; code: "user_not_found" | "ban_failed" }
> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { banned: false, error: "Email is required", code: "user_not_found" };
  }

  try {
    const lookup = await findUserByEmail(normalizedEmail);
    if (!lookup.found) {
      return {
        banned: false,
        error: lookup.error,
        code: "user_not_found",
      };
    }

    const result = await banUserFromFlixa(
      lookup.userId,
      reason,
      clientHeaders,
    );
    if (!result.banned) {
      return {
        banned: false,
        error: result.error,
        code: "ban_failed",
      };
    }

    return {
      banned: true,
      userId: lookup.userId,
      email: lookup.email,
      alreadyBanned: result.alreadyBanned,
      reason,
    };
  } catch (error) {
    console.error(`[Ban] Failed to ban by email=${normalizedEmail}:`, error);
    return {
      banned: false,
      error: error instanceof Error ? error.message : "ban_failed",
      code: "ban_failed",
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
    const lookup = await findUserByEmail(normalizedEmail);
    if (!lookup.found) {
      return {
        unbanned: false,
        error: lookup.error,
        code: "user_not_found",
      };
    }

    const result = await unbanUserFromFlixa(lookup.userId);
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
      email: lookup.email,
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

/** Free/Go on an unlisted client (no ban). */
export const MISSING_CLIENT_SIGNAL_MESSAGE =
  "This app is not available on your plan. On the Free and Go plans, Deni AI API keys can only be used from Codex, Claude Code, OpenCode, Zed, or Flixa. Upgrade to Plus or higher to use other apps.";

/** Soft-reject for legacy AI SDK / outdated Flixa clients on Free/Go (no ban). */
export const CLIENT_UPDATE_REQUIRED_MESSAGE =
  "Please update your Deni AI Flixa to continue. To use Flixa from other apps, upgrade to Plus or higher.";
