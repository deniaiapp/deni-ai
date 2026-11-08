/**
 * Educational email check. Must match deni-ai/src/lib/email-domain-policy.ts
 * (`ALLOWED_EDU_DOMAIN_SUFFIXES`, `isEducationalEmail`): a verified address on
 * one of these domains gets Go at no charge in Deni AI and Flixa alike.
 */
const ALLOWED_EDU_DOMAIN_SUFFIXES: readonly string[] = [
  "edu",
  "ac.jp",
  "ed.jp",
  "ac.uk",
  "sch.uk",
  "edu.au",
  "ac.nz",
  "ac.kr",
  "edu.tw",
  "edu.sg",
  "edu.hk",
];

function extractEmailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1).replace(/\.+$/, "");
  if (!domain || domain.includes(" ") || domain.includes("@")) return null;
  return domain;
}

export function isEducationalEmail(email: string): boolean {
  const domain = extractEmailDomain(email);
  if (!domain || domain.split(".").filter(Boolean).length < 2) return false;
  return ALLOWED_EDU_DOMAIN_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  );
}
