const REDIRECT_BASE = "https://deni-ai.invalid";

/**
 * Post-auth destinations come from the URL (`?redirectTo=`), so anyone can set
 * them. Allow only same-origin paths: absolute and protocol-relative URLs, and
 * backslash, tab or userinfo tricks that browsers resolve off-site, fall back.
 */
export function toSafeRedirectPath(value: string | null | undefined, fallback = "/chat") {
  const candidate = value?.trim();
  if (!candidate?.startsWith("/")) return fallback;

  try {
    const parsed = new URL(candidate, REDIRECT_BASE);
    if (parsed.origin !== REDIRECT_BASE) return fallback;
    // Dot segments are removed while parsing, so `/.//evil.example` keeps the
    // origin above but normalizes to the protocol-relative `//evil.example`.
    if (parsed.pathname.startsWith("//")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
