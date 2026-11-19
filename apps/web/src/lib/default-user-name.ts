/**
 * Name for an account created without one: the email's local part, or the whole
 * address if it has none. Magic-link sign-ups send only an email, so Better Auth
 * would otherwise store an empty name.
 */
export function defaultUserName(email: string): string {
  const at = email.lastIndexOf("@");
  const localPart = (at === -1 ? email : email.slice(0, at)).trim();
  return localPart || email.trim();
}

/** `name` when it has visible characters; otherwise {@link defaultUserName}. */
export function resolveUserName(name: string | null | undefined, email: string): string {
  return name?.trim() ? name : defaultUserName(email);
}
