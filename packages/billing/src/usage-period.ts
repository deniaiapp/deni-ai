/** The UTC calendar month a usage amount belongs to, matching the quota reset window. */
export function usageMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first instant of the next UTC month: when the shared pool resets. */
export function usageMonthEnd(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}
