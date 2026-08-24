const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Explicit local/development bypass for Flixa-side authentication and limits.
 * This must never be enabled on an internet-facing production instance.
 */
export function isAuthDisabledMode(): boolean {
  const raw = Bun.env.FLIXA_AUTH_DISABLED?.trim().toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

/** Stable synthetic user id used when API authentication is bypassed. */
export function getAuthDisabledUserId(): string {
  return Bun.env.FLIXA_AUTH_DISABLED_USER_ID?.trim() || "auth-disabled-user";
}
