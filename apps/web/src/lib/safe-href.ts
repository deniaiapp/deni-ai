const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * True for same-origin paths only.
 *
 * A bare `startsWith("/")` also accepts protocol-relative URLs — browsers resolve
 * `//evil.com` against the current scheme and navigate off-site, so those must go
 * through protocol validation instead. Backslashes are rejected because several
 * browsers normalise `/\` to `//`.
 */
function isSameOriginPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

export function toSafeHref(value: string | null | undefined, fallback = "#") {
  if (!value) {
    return fallback;
  }

  if (isSameOriginPath(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function getSafeDisplayUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }

    return {
      href: parsed.toString(),
      origin: `${parsed.protocol}//`,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
    };
  } catch {
    return null;
  }
}
