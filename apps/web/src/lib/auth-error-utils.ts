const SESSION_NOT_FRESH_ERROR_CODE = "SESSION_NOT_FRESH";

/** Return whether a Better Auth error indicates that the session must be reverified. */
export function isSessionNotFreshError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const errorObject = error as { code?: unknown; error?: unknown };
  if (errorObject.code === SESSION_NOT_FRESH_ERROR_CODE) return true;

  if (typeof errorObject.error !== "object" || errorObject.error === null) return false;

  return (errorObject.error as { code?: unknown }).code === SESSION_NOT_FRESH_ERROR_CODE;
}
