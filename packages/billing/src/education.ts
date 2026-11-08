/**
 * Educational email policy. A verified address on one of these domains gets Go
 * at no charge in Deni AI chat and Flixa alike, and Deni AI also accepts these
 * domains at sign-up.
 */

/**
 * Educational domain suffixes with restricted registration (institutions only).
 *
 * Match when `domain === suffix` or `domain.endsWith("." + suffix)`.
 * Open / high-abuse namespaces (e.g. `.edu.kg`, bare `.ac` Ascension TLD,
 * most `.edu.<cc>` without real eligibility checks) are intentionally omitted.
 *
 * Add a suffix here only when the registry limits names to real schools.
 */
export const ALLOWED_EDU_DOMAIN_SUFFIXES: readonly string[] = [
  // United States: sponsored gTLD, eligibility-restricted
  "edu",
  // Japan: JPRS academic / school namespaces
  "ac.jp",
  "ed.jp",
  // United Kingdom: JANET academic / school
  "ac.uk",
  "sch.uk",
  // Australia: auDA education eligibility
  "edu.au",
  // New Zealand: academic
  "ac.nz",
  // South Korea: academic
  "ac.kr",
  // Taiwan: education
  "edu.tw",
  // Singapore: education
  "edu.sg",
  // Hong Kong: education
  "edu.hk",
];

/** Lowercased domain of an address, or null when the address is malformed. */
export function extractEmailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  // strip trailing dots / ignore display-name forms
  const domain = trimmed.slice(at + 1).replace(/\.+$/, "");
  if (!domain || domain.includes(" ") || domain.includes("@")) return null;
  return domain;
}

function domainMatchesSuffix(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

/**
 * Educational domain check (restricted-registration allowlist only).
 * - `mit.edu`, `cs.stanford.edu`: allowed (US `.edu`)
 * - `u-tokyo.ac.jp`, `school.ed.jp`: allowed
 * - `ox.ac.uk`, `uni.edu.au`: allowed
 * - `cmuk.edu.kg`, `foo.edu.co`, bare `something.ac`: denied
 */
export function isAllowedEducationalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  const labels = d.split(".").filter(Boolean);
  // Need at least school.edu or school.ac.jp
  if (labels.length < 2) return false;

  return ALLOWED_EDU_DOMAIN_SUFFIXES.some((suffix) => domainMatchesSuffix(d, suffix));
}

/** Whether an address is on a restricted educational domain (see {@link isAllowedEducationalDomain}). */
export function isEducationalEmail(email: string): boolean {
  const domain = extractEmailDomain(email);
  return domain !== null && isAllowedEducationalDomain(domain);
}
