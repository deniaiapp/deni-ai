import {
  ALLOWED_EDU_DOMAIN_SUFFIXES,
  isAllowedEmailProviderDomain,
  isGoogleMailDomain,
} from "@/lib/email-domain-policy";

export const TEAM_DOMAIN_JOIN_MODES = ["auto", "request", "off"] as const;
export type TeamDomainJoinMode = (typeof TEAM_DOMAIN_JOIN_MODES)[number];
export const DEFAULT_TEAM_DOMAIN_JOIN_MODE: TeamDomainJoinMode = "request";

export function toTeamDomainJoinMode(value: string | null | undefined): TeamDomainJoinMode {
  return TEAM_DOMAIN_JOIN_MODES.find((mode) => mode === value) ?? DEFAULT_TEAM_DOMAIN_JOIN_MODE;
}

/** DNS name (under the domain) whose TXT record proves the team controls it. */
export const TEAM_DOMAIN_TXT_LABEL = "_deni-ai-verification";

export function teamDomainTxtRecord(domain: string, token: string) {
  return { name: `${TEAM_DOMAIN_TXT_LABEL}.${domain}`, value: `deni-ai-verification=${token}` };
}

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase hostname from user input (`@Example.com.` → `example.com`), or null. */
export function normalizeTeamDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/^@/, "").replace(/\.+$/, "");
  if (!domain || domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => HOSTNAME_LABEL.test(label))) return null;
  // The top-level label is never all digits; this also rules out IPv4 addresses.
  if (/^\d+$/.test(labels.at(-1) ?? "")) return null;
  return domain;
}

/**
 * Mail providers and bare educational suffixes are shared by unrelated people,
 * so no team can claim them even with a matching DNS record.
 */
export function isSharedEmailDomain(domain: string) {
  return (
    isGoogleMailDomain(domain) ||
    isAllowedEmailProviderDomain(domain) ||
    domain === "duck.com" ||
    ALLOWED_EDU_DOMAIN_SUFFIXES.includes(domain)
  );
}
