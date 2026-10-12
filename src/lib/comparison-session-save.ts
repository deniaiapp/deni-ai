/** The comparison being saved no longer exists (deleted in another tab or on another device). */
export function isComparisonGoneError(error: unknown) {
  return (error as { data?: { code?: unknown } | null } | null)?.data?.code === "NOT_FOUND";
}

/**
 * Saves a comparison over its saved id, or as a new comparison once that id is
 * gone: saving to a deleted comparison fails the same way on every retry, and
 * the unsaved turns would be lost when the page is left.
 */
export async function saveComparisonSession(
  save: (id: string | undefined) => Promise<string>,
  id: string | undefined,
): Promise<{ id: string; recreated: boolean }> {
  try {
    return { id: await save(id), recreated: false };
  } catch (error) {
    if (!id || !isComparisonGoneError(error)) throw error;
    return { id: await save(undefined), recreated: true };
  }
}
