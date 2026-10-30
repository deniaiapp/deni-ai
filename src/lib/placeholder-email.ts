/**
 * Guest (anonymous) accounts get a non-routable address from Better Auth's
 * anonymous plugin, `<id>@anonymous.placeholder.invalid` (RFC 6761 reserves
 * `.invalid`). Nothing can be delivered to it, and it is not the person's
 * address, so it is neither mailed nor shown.
 */
export function isPlaceholderEmail(email: string | null | undefined) {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(".invalid");
}
