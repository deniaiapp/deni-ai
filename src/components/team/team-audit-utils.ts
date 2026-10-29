import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  Building2,
  CreditCard,
  Globe,
  MailX,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  XCircle,
  Zap,
} from "lucide-react";
import { useExtracted } from "use-intl";
import { numberFormatter } from "./team-utils";
import { useRoleLabel } from "./use-role-label";

export type AuditLogMetadata = Record<string, unknown> & {
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
};

const POLICY_FIELDS = ["maxModeEnabled", "maxModeLimitBasic", "maxModeLimitPremium"] as const;

export type AuditChangeLine = {
  field: string;
  previous: string;
  next: string;
};

export function useAuditActionMeta() {
  const t = useExtracted();
  return (action: string) => {
    switch (action) {
      case "max_mode_enabled":
        return { label: t("Team Max Mode enabled"), icon: Zap };
      case "max_mode_disabled":
        return { label: t("Team Max Mode disabled"), icon: Ban };
      case "default_policy_updated":
        return { label: t("Default policy updated"), icon: ShieldCheck };
      case "member_policy_updated":
        return { label: t("Member policy updated"), icon: Users };
      case "member_invited":
        return { label: t("Member invited"), icon: UserPlus };
      case "member_joined":
        return { label: t("Member joined"), icon: UserCheck };
      case "member_role_updated":
        return { label: t("Member role updated"), icon: ShieldCheck };
      case "member_removed":
        return { label: t("Member removed"), icon: UserMinus };
      case "subscription_purchased":
        return { label: t("Subscription purchased"), icon: CreditCard };
      case "plan_changed":
        return { label: t("Plan changed"), icon: RefreshCw };
      case "subscription_canceled":
        return { label: t("Subscription canceled"), icon: XCircle };
      case "subscription_resumed":
        return { label: t("Subscription resumed"), icon: RotateCcw };
      case "org_updated":
        return { label: t("Team details updated"), icon: Pencil };
      case "org_created":
        return { label: t("Team created"), icon: Building2 };
      case "invitation_canceled":
        return { label: t("Invitation canceled"), icon: MailX };
      case "invitation_declined":
        return { label: t("Invitation declined"), icon: UserX };
      case "seats_synced":
        return { label: t("Seat count synced"), icon: RefreshCw };
      case "subscription_expired":
        return { label: t("Subscription expired"), icon: AlertOctagon };
      case "payment_failed":
        return { label: t("Payment failed"), icon: AlertTriangle };
      case "domain_added":
        return { label: t("Domain added"), icon: Globe };
      case "domain_verified":
        return { label: t("Domain verified"), icon: ShieldCheck };
      case "domain_removed":
        return { label: t("Domain removed"), icon: Globe };
      case "domain_join_mode_updated":
        return { label: t("Domain joining updated"), icon: Globe };
      case "join_requested":
        return { label: t("Join requested"), icon: UserPlus };
      case "join_request_declined":
        return { label: t("Join request declined"), icon: UserX };
      default:
        return { label: action, icon: ShieldCheck };
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function useAuditActionSentence() {
  const t = useExtracted();
  const roleLabel = useRoleLabel();

  const planLabel = (planId: unknown) => {
    if (planId === "pro_team_monthly") return t("Pro monthly");
    if (planId === "pro_team_yearly") return t("Pro yearly");
    return typeof planId === "string" && planId ? planId : t("Unknown plan");
  };

  return (action: string, targetLabel?: string | null, metadata?: unknown) => {
    const data = asRecord(metadata);
    switch (action) {
      case "max_mode_enabled":
        return t("enabled Team Max Mode for the team");
      case "max_mode_disabled":
        return t("disabled Team Max Mode for the team");
      case "default_policy_updated":
        return t("updated the default Max Mode policy");
      case "member_policy_updated":
        return targetLabel
          ? t("updated {target}'s Max Mode policy", { target: targetLabel })
          : t("updated a member's Max Mode policy");
      case "member_invited": {
        const email = typeof data?.email === "string" ? data.email : null;
        return email
          ? t("invited {email} to the team", { email })
          : t("invited a new member to the team");
      }
      case "member_joined":
        // An approved join request is the one case with a different actor.
        if (data?.source === "domain_request" && targetLabel) {
          return t("approved {target}'s request to join the team", { target: targetLabel });
        }
        // Otherwise actor and target are the same person (self-action), so the
        // sentence must not repeat their name — it already prefixes actorName.
        if (data?.source === "domain_auto") return t("joined the team through the email domain");
        return t("joined the team");
      case "member_role_updated": {
        const newRole = typeof data?.newRole === "string" ? roleLabel(data.newRole) : null;
        if (targetLabel && newRole) {
          return t("changed {target}'s role to {role}", { target: targetLabel, role: newRole });
        }
        if (newRole) return t("changed a member's role to {role}", { role: newRole });
        return t("changed a member's role");
      }
      case "member_removed":
        return targetLabel
          ? t("removed {target} from the team", { target: targetLabel })
          : t("removed a member from the team");
      case "subscription_purchased":
        return t("purchased the {plan} plan", { plan: planLabel(data?.planId) });
      case "plan_changed": {
        const previous = asRecord(data?.previous);
        const next = asRecord(data?.next);
        return t("changed the plan from {from} to {to}", {
          from: planLabel(previous?.planId),
          to: planLabel(next?.planId),
        });
      }
      case "subscription_canceled":
        return t("canceled the team subscription");
      case "subscription_resumed":
        return t("resumed the team subscription");
      case "org_updated": {
        const name = typeof data?.name === "string" ? data.name : null;
        if (name) return t("renamed the team to “{name}”", { name });
        if (data?.logoChanged) return t("changed the team icon");
        return t("updated the team details");
      }
      case "org_created": {
        const name = typeof data?.name === "string" ? data.name : null;
        return name ? t("created the team “{name}”", { name }) : t("created the team");
      }
      case "invitation_canceled": {
        const email = typeof data?.email === "string" ? data.email : null;
        return email
          ? t("canceled the invitation for {email}", { email })
          : t("canceled a pending invitation");
      }
      case "invitation_declined":
        // actor and target are the same person here (self-action), same as
        // member_joined above — must not repeat their name.
        return t("declined the invitation to join the team");
      case "seats_synced":
        return t("synced the team's seat count with billing");
      case "subscription_expired":
        return t("no longer has an active team subscription");
      case "payment_failed":
        return t("had a payment fail for the team subscription");
      case "domain_added":
      case "domain_verified":
      case "domain_removed": {
        const domain = typeof data?.domain === "string" ? data.domain : "";
        if (action === "domain_added") return t("added the domain {domain}", { domain });
        if (action === "domain_verified") return t("verified the domain {domain}", { domain });
        return t("removed the domain {domain}", { domain });
      }
      case "domain_join_mode_updated": {
        const mode = asRecord(data?.next)?.joinMode;
        if (mode === "auto") return t("set domain users to join automatically");
        if (mode === "request") return t("set domain users to request to join");
        return t("turned off joining by domain");
      }
      case "join_requested":
        return t("asked to join the team");
      case "join_request_declined":
        return targetLabel
          ? t("declined {target}'s request to join the team", { target: targetLabel })
          : t("declined a request to join the team");
      default:
        return action;
    }
  };
}

export function useFormatAuditChanges() {
  const t = useExtracted();

  const formatLimit = (value: unknown) => {
    if (value === null || value === undefined) return t("Unlimited");
    if (typeof value === "number") return numberFormatter.format(value);
    return String(value);
  };
  const formatEnabled = (value: unknown) => (value ? t("Enabled") : t("Disabled"));
  const formatValue = (field: (typeof POLICY_FIELDS)[number], value: unknown) =>
    field === "maxModeEnabled" ? formatEnabled(value) : formatLimit(value);

  const fieldLabel = (field: (typeof POLICY_FIELDS)[number]) => {
    switch (field) {
      case "maxModeEnabled":
        return t("Max Mode");
      case "maxModeLimitBasic":
        return t("Basic limit");
      case "maxModeLimitPremium":
        return t("Premium limit");
      default:
        return field;
    }
  };

  return (action: string, metadata: unknown): AuditChangeLine[] => {
    if (action !== "default_policy_updated" && action !== "member_policy_updated") return [];
    if (!metadata || typeof metadata !== "object") return [];

    const data = metadata as AuditLogMetadata;
    // Older audit rows recorded before before/after tracking was added store a flat
    // object with no `previous`/`next` split — we can't tell what changed, so skip them
    // instead of dumping the entire policy as if every field were new.
    if (!data.previous || !data.next) return [];

    const next = data.next;
    const previous = data.previous;

    const lines: AuditChangeLine[] = [];
    for (const field of POLICY_FIELDS) {
      if (!(field in next) || !(field in previous)) continue;
      const nextValue = formatValue(field, next[field]);
      const previousValue = formatValue(field, previous[field]);
      if (previousValue === nextValue) continue;
      lines.push({ field: fieldLabel(field), previous: previousValue, next: nextValue });
    }
    return lines;
  };
}

export function getInitials(name?: string | null, email?: string | null) {
  const source = name || email || "";
  return source.slice(0, 2).toUpperCase();
}
