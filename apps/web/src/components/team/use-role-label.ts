import { useExtracted } from "use-intl";

/**
 * Translates a raw better-auth member role ("owner" | "admin" | "member") into
 * display text. Falls back to capitalizing whatever string comes in for any role
 * this app doesn't define (defensive only — the codebase has no custom roles).
 */
export function useRoleLabel() {
  const t = useExtracted();

  return (role: string) => {
    switch (role) {
      case "owner":
        return t("Owner");
      case "admin":
        return t("Admin");
      case "member":
        return t("Member");
      default:
        return role.length > 0 ? role.charAt(0).toUpperCase() + role.slice(1) : role;
    }
  };
}
