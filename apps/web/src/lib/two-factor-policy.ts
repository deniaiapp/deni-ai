/**
 * Two-factor requirement for password accounts.
 *
 * An account that can sign in with email + password (a `credential` account)
 * and has neither Google nor GitHub linked must turn on two-factor
 * authentication. Until `PASSWORD_2FA_REQUIRED_FROM` it is only reminded (grace);
 * from that moment signed-in app routes send it to the setup screen. Guests,
 * accounts with Google or GitHub linked, and accounts without a password
 * (magic link or passkey only) are exempt. Unlinking the last social account
 * makes a password account subject to the rule again, because the status is
 * derived from the linked accounts on every check.
 */

/** Providers whose own sign-in protection exempts an account. */
export const TWO_FACTOR_EXEMPT_PROVIDERS = ["google", "github"] as const;
/** Better Auth's provider id for email + password. */
export const PASSWORD_PROVIDER_ID = "credential";

export type TwoFactorPolicyStatus =
  /** Not subject to the rule. */
  | "exempt"
  /** Subject to the rule and two-factor is on. */
  | "satisfied"
  /** Subject, two-factor is off, the deadline has not passed (or there is none). */
  | "grace"
  /** Subject, two-factor is off, the deadline has passed: app routes redirect. */
  | "required";

export type TwoFactorExemptReason = "guest" | "social-account" | "no-password";

export type TwoFactorPolicy = {
  status: TwoFactorPolicyStatus;
  /** ISO time from which two-factor is required; null when no deadline is set. */
  deadline: string | null;
  exemptReason?: TwoFactorExemptReason;
};

export type TwoFactorPolicyInput = {
  isAnonymous: boolean;
  twoFactorEnabled: boolean;
  /** `account.provider_id` of every account linked to the user. */
  providerIds: readonly string[];
  now: Date;
  /** Parsed `PASSWORD_2FA_REQUIRED_FROM`; null keeps the grace period forever. */
  requiredFrom: Date | null;
};

export function evaluateTwoFactorPolicy(input: TwoFactorPolicyInput): TwoFactorPolicy {
  const deadline = input.requiredFrom?.toISOString() ?? null;
  if (input.isAnonymous) {
    return { status: "exempt", deadline, exemptReason: "guest" };
  }
  if (
    input.providerIds.some((id) => (TWO_FACTOR_EXEMPT_PROVIDERS as readonly string[]).includes(id))
  ) {
    return { status: "exempt", deadline, exemptReason: "social-account" };
  }
  if (!input.providerIds.includes(PASSWORD_PROVIDER_ID)) {
    return { status: "exempt", deadline, exemptReason: "no-password" };
  }
  if (input.twoFactorEnabled) {
    return { status: "satisfied", deadline };
  }
  if (!input.requiredFrom || input.now.getTime() < input.requiredFrom.getTime()) {
    return { status: "grace", deadline };
  }
  return { status: "required", deadline };
}

/**
 * Parses `PASSWORD_2FA_REQUIRED_FROM`: an ISO date (`2027-01-15`, midnight UTC)
 * or date-time. Empty or invalid values mean "no deadline".
 */
export function parseTwoFactorDeadline(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Paths a `required` account may still open: the setup screen and security settings. */
export const TWO_FACTOR_SETUP_PATH = "/two-factor/setup";
const TWO_FACTOR_ALLOWED_PREFIXES = [TWO_FACTOR_SETUP_PATH, "/account/security"] as const;

export function isAllowedWhileTwoFactorRequired(pathname: string): boolean {
  return TWO_FACTOR_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
