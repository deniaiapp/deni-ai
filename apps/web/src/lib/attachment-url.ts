/**
 * Stored attachments are referenced by an app-relative URL. The route behind
 * it checks the session owns the file before redirecting to a short-lived
 * signed storage URL, so these URLs are safe to keep in chat history.
 */
export const ATTACHMENT_URL_PREFIX = "/api/attachments/";

/** Ids are random URL-safe strings (see `newAttachmentId`). */
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isAttachmentId(value: string): boolean {
  return ATTACHMENT_ID_PATTERN.test(value);
}

export function attachmentUrl(id: string): string {
  return `${ATTACHMENT_URL_PREFIX}${id}`;
}

/**
 * The attachment id in an app attachment URL, or `null` for anything else.
 * Only the exact relative form the upload route returns is recognized.
 */
export function parseAttachmentUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return null;
  const id = url.slice(ATTACHMENT_URL_PREFIX.length);
  return isAttachmentId(id) ? id : null;
}

/**
 * The attachment id in an app attachment URL: the relative form, or the same
 * path on the app's own origin (`appOrigin`, for example a URL copied from the
 * address bar). `null` for anything else, including another origin and a URL
 * with credentials, a query or a fragment.
 */
export function parseAppAttachmentUrl(url: string, appOrigin: string | null): string | null {
  const relative = parseAttachmentUrl(url);
  if (relative || appOrigin === null) return relative;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.origin !== appOrigin ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  return parseAttachmentUrl(parsed.pathname);
}
