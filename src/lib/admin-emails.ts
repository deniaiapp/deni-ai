import { env } from "@/env";
import { extractEmailDomain } from "@/lib/email-domain-policy";

export function parseAdminEmails(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Operator allowlist (reset-credit grants, dispute alerts, blog fallback).
 * `AFFILIATE_ADMIN_EMAILS` is the name from before the affiliate program was
 * removed; it is still read so existing deployments keep their admins.
 */
export function getAdminEmails() {
  return parseAdminEmails(env.ADMIN_EMAILS ?? env.AFFILIATE_ADMIN_EMAILS);
}

/** Operator email domains: their accounts may sign up and administer like `ADMIN_EMAILS`. */
export function getAdminEmailDomains() {
  return new Set(
    [...parseAdminEmails(env.ADMIN_EMAIL_DOMAINS)].map((domain) => domain.replace(/^@/, "")),
  );
}

export function isAdminEmailDomain(email: string | null | undefined) {
  const domain = email ? extractEmailDomain(email) : null;
  return Boolean(domain && getAdminEmailDomains().has(domain));
}

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(
    email && (getAdminEmails().has(email.trim().toLowerCase()) || isAdminEmailDomain(email)),
  );
}
