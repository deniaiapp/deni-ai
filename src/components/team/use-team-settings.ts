"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useExtracted } from "next-intl";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { authClient } from "@/lib/auth-client";
import type { TeamPlanId } from "@/lib/billing";
import { useReloadCooldown } from "@/hooks/use-reload-cooldown";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { trpc } from "@/lib/trpc/react";
import {
  isInvitation,
  isMember,
  type Member,
  type Organization,
  type ReceivedInvitation,
} from "./team-types";
import { runWithLoading } from "@/lib/run-with-loading";
import { createTeamSlug, escapeCsvCell, parseTokenLimit } from "./team-utils";

export function useTeamSettings() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const { push } = useRouter();
  const session = authClient.useSession();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { features } = usePlatformCapabilities();

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [updatingMemberRoleId, setUpdatingMemberRoleId] = useState<string | null>(null);
  const [shredOpen, setShredOpen] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [isSavingOrgName, setIsSavingOrgName] = useState(false);
  const [isSavingOrgLogo, setIsSavingOrgLogo] = useState(false);
  const [respondingInvitationId, setRespondingInvitationId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);
  const [pendingTeamPlanId, setPendingTeamPlanId] = useState<TeamPlanId | null>(null);
  const [hasAgreedToTeamPlanChange, setHasAgreedToTeamPlanChange] = useState(false);
  const currentUserId = session.data?.user?.id ?? null;
  // An invitation link only points at the invitation. Joining always takes an explicit
  // Accept click: accepting can cancel the invitee's personal subscription, so a page
  // load (or a link someone else sent) must never do it.
  const linkedInvitationId = searchParams.get("invitationId");

  const { data: organizationsData, isLoading: organizationsLoading } = useQuery({
    queryKey: ["team", "organizations", currentUserId],
    enabled: !session.isPending,
    queryFn: async () => {
      const result = await authClient.organization.list({});
      return (result.data ?? []) as Organization[];
    },
  });
  const { data: myInvitationsData } = useQuery({
    queryKey: ["team", "my-invitations", currentUserId],
    enabled: !session.isPending && Boolean(currentUserId),
    queryFn: async () => {
      const result = await authClient.organization.listUserInvitations();
      // Not every account has a verified email (invitation lookup requires one) —
      // fail quietly here instead of surfacing an error for what is a secondary list.
      return (result.data ?? []) as ReceivedInvitation[];
    },
  });
  const { data: linkedInvitation } = useQuery({
    queryKey: ["team", "linked-invitation", currentUserId, linkedInvitationId],
    enabled: !session.isPending && Boolean(currentUserId) && Boolean(linkedInvitationId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<ReceivedInvitation | null> => {
      // Unlike listUserInvitations, this also works before the email is verified.
      const result = await authClient.organization.getInvitation({
        query: { id: linkedInvitationId ?? "" },
      });
      if (result.error || !result.data) {
        toast.error(localizeError(result.error, t("Invitation not found")));
        return null;
      }
      const { id, organizationId, organizationName, role, status, expiresAt } = result.data;
      return { id, organizationId, organizationName, role, status, expiresAt };
    },
  });
  const listedPendingInvitations = (myInvitationsData ?? []).filter(
    (inv) => inv.status === "pending",
  );
  const myPendingInvitations =
    linkedInvitation?.status === "pending" &&
    !listedPendingInvitations.some((inv) => inv.id === linkedInvitation.id)
      ? [linkedInvitation, ...listedPendingInvitations]
      : listedPendingInvitations;
  const activeOrganizationId = session.data?.session?.activeOrganizationId ?? null;
  const organizations = organizationsData ?? [];
  const activeOrg =
    (selectedOrgId ? organizations.find((org) => org.id === selectedOrgId) : undefined) ??
    organizations.find((org) => org.id === activeOrganizationId) ??
    organizations[0] ??
    null;
  const { data: orgDetailsData, refetch: refetchOrgDetails } = useQuery({
    queryKey: ["team", "organization", currentUserId, activeOrg?.id],
    enabled: Boolean(activeOrg?.id),
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization({
        query: { organizationId: activeOrg?.id ?? "" },
      });
      return result.data ?? null;
    },
  });
  const {
    reload: reloadMembers,
    isReloading: isReloadingMembers,
    isCoolingDown: isMembersReloadCoolingDown,
  } = useReloadCooldown(() => refetchOrgDetails());
  const createPortal = trpc.organization.createTeamPortalSession.useMutation();
  const createTeamCheckout = trpc.organization.createTeamCheckoutSession.useMutation();
  const changeTeamPlan = trpc.organization.changeTeamPlan.useMutation();
  const cancelSub = trpc.organization.cancelTeamSubscription.useMutation();
  const resumeSub = trpc.organization.resumeTeamSubscription.useMutation();
  const updateTeamMaxMode = trpc.organization.updateTeamMaxModeEnabled.useMutation();
  const updateTeamMaxModeDefaultPolicy =
    trpc.organization.updateTeamMaxModeDefaultPolicy.useMutation();
  const updateMemberMaxModePolicy = trpc.organization.updateTeamMemberMaxModePolicy.useMutation();
  const utils = trpc.useUtils();
  const members = (orgDetailsData?.members ?? []).filter(isMember);
  const invitations = (orgDetailsData?.invitations ?? []).filter(isInvitation);
  const pendingInvitations = invitations.filter((inv) => inv.status === "pending");
  const currentUserRole = members.find((member) => member.userId === currentUserId)?.role ?? null;
  const isOwner = currentUserRole === "owner";
  const isAdmin = currentUserRole === "admin" || isOwner;
  const teamBillingQuery = trpc.organization.teamBillingStatus.useQuery(
    { organizationId: activeOrg?.id ?? "" },
    { enabled: features.billing && Boolean(activeOrg?.id) && isAdmin },
  );
  const teamMaxModeQuery = trpc.organization.teamMaxModeSettings.useQuery(
    { organizationId: activeOrg?.id ?? "" },
    { enabled: features.billing && Boolean(activeOrg?.id) && isAdmin },
  );
  const teamPlansQuery = trpc.organization.teamPlans.useQuery(undefined, {
    enabled: features.billing && Boolean(activeOrg?.id) && isAdmin,
  });
  const teamPlanEstimateQuery = trpc.organization.estimateTeamPlanChange.useQuery(
    { organizationId: activeOrg?.id ?? "", planId: pendingTeamPlanId ?? "pro_team_monthly" },
    {
      enabled: features.billing && Boolean(activeOrg?.id) && pendingTeamPlanId !== null,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  const isChangePlanDialogOpen =
    pendingTeamPlanId !== null &&
    !teamPlanEstimateQuery.isFetching &&
    (teamPlanEstimateQuery.data !== undefined || teamPlanEstimateQuery.error !== null);

  async function selectOrg(org: Organization, options?: { persistActive?: boolean }) {
    setSelectedOrgId(org.id);
    if (options?.persistActive !== false && org.id !== activeOrganizationId) {
      await authClient.organization.setActive({ organizationId: org.id });
      await session.refetch();
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    await runWithLoading(setIsCreatingOrg, async () => {
      try {
        const result = await authClient.organization.create({
          name: newOrgName.trim(),
          slug: createTeamSlug(newOrgName),
        });
        if (result.error) {
          toast.error(localizeError(result.error, t("Failed to create organization")));
          return;
        }
        if (result.data) {
          const created = result.data as Organization;
          queryClient.setQueryData<Organization[]>(
            ["team", "organizations", currentUserId],
            (current) => {
              const list = current ?? [];
              if (list.some((org) => org.id === created.id)) {
                return list;
              }
              return [...list, created];
            },
          );
          await selectOrg(created);
          await queryClient.invalidateQueries({
            queryKey: ["team", "organizations", currentUserId],
          });
          toast.success(t("Organization created"));
          setIsCreateDialogOpen(false);
          setNewOrgName("");
        }
      } catch (error) {
        console.error("Failed to create org", error);
        toast.error(t("Failed to create organization"));
      }
    });
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !activeOrg) return;
    await runWithLoading(setIsInviting, async () => {
      try {
        const result = await authClient.organization.inviteMember({
          email: inviteEmail.trim(),
          role: inviteRole as "member" | "admin",
          organizationId: activeOrg.id,
        });
        // better-auth returns API errors instead of throwing; keep the dialog open
        // so the address can be corrected.
        if (result.error) {
          toast.error(localizeError(result.error, t("Failed to send invitation")));
          return;
        }
        toast.success(t("Invitation sent"));
        await queryClient.invalidateQueries({
          queryKey: ["team", "organization", currentUserId, activeOrg.id],
        });
        setIsInviteDialogOpen(false);
        setInviteEmail("");
        setInviteRole("member");
      } catch (error) {
        console.error("Failed to invite", error);
        toast.error(t("Failed to send invitation"));
      }
    });
  }

  async function handleRemoveMember(memberId: string) {
    if (!activeOrg) return;
    await runWithLoading(setIsRemovingMember, async () => {
      try {
        const result = await authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: activeOrg.id,
        });
        if (result.error) {
          toast.error(localizeError(result.error, t("Failed to remove member")));
          return;
        }
        toast.success(t("Member removed"));
        await queryClient.invalidateQueries({
          queryKey: ["team", "organization", currentUserId, activeOrg.id],
        });
        setMemberToRemove(null);
      } catch (error) {
        console.error("Failed to remove member", error);
        toast.error(t("Failed to remove member"));
      }
    });
  }

  async function handleUpdateMemberRole(member: Member, role: "admin" | "member") {
    if (!activeOrg) return;
    await runWithLoading(
      (loading) => setUpdatingMemberRoleId(loading ? member.id : null),
      async () => {
        try {
          const result = await authClient.organization.updateMemberRole({
            memberId: member.id,
            role,
            organizationId: activeOrg.id,
          });
          if (result.error) {
            toast.error(localizeError(result.error, t("Failed to update role")));
            return;
          }
          toast.success(t("Role updated"));
          await queryClient.invalidateQueries({
            queryKey: ["team", "organization", currentUserId, activeOrg.id],
          });
        } catch (error) {
          console.error("Failed to update member role", error);
          toast.error(t("Failed to update role"));
        }
      },
    );
  }

  async function handleUpdateOrgName() {
    const trimmedName = orgNameDraft.trim();
    if (!activeOrg || !trimmedName || trimmedName === activeOrg.name) return;
    await runWithLoading(setIsSavingOrgName, async () => {
      try {
        const result = await authClient.organization.update({
          organizationId: activeOrg.id,
          data: { name: trimmedName },
        });
        if (result.error) {
          toast.error(localizeError(result.error, t("Failed to update team name")));
          return;
        }
        queryClient.setQueryData<Organization[]>(
          ["team", "organizations", currentUserId],
          (current) =>
            (current ?? []).map((org) =>
              org.id === activeOrg.id ? { ...org, name: trimmedName } : org,
            ),
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["team", "organizations", currentUserId] }),
          queryClient.invalidateQueries({
            queryKey: ["team", "organization", currentUserId, activeOrg.id],
          }),
        ]);
        toast.success(t("Team name updated"));
      } catch (error) {
        console.error("Failed to update team name", error);
        toast.error(t("Failed to update team name"));
      }
    });
  }

  async function updateOrgLogo(logo: string | null) {
    if (!activeOrg) return;
    await runWithLoading(setIsSavingOrgLogo, async () => {
      try {
        const result = await authClient.organization.update({
          organizationId: activeOrg.id,
          data: { logo },
        });
        if (result.error) {
          toast.error(
            localizeError(
              result.error,
              logo ? t("Failed to update team icon") : t("Failed to remove team icon"),
            ),
          );
          return;
        }
        queryClient.setQueryData<Organization[]>(
          ["team", "organizations", currentUserId],
          (current) =>
            (current ?? []).map((org) => (org.id === activeOrg.id ? { ...org, logo } : org)),
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["team", "organizations", currentUserId] }),
          queryClient.invalidateQueries({
            queryKey: ["team", "organization", currentUserId, activeOrg.id],
          }),
        ]);
        toast.success(logo ? t("Team icon updated") : t("Team icon removed"));
      } catch (error) {
        console.error("Failed to update team icon", error);
        toast.error(logo ? t("Failed to update team icon") : t("Failed to remove team icon"));
      }
    });
  }

  async function handleUpdateOrgLogo(file: File) {
    const logo = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => {
        console.error("Failed to read team icon file", reader.error);
        toast.error(t("Failed to update team icon"));
        resolve(null);
      };
      reader.onload = () => {
        const result = reader.result;
        resolve(typeof result === "string" ? result : null);
      };
      reader.readAsDataURL(file);
    });
    if (!logo) return;
    await updateOrgLogo(logo);
  }

  async function handleRemoveOrgLogo() {
    await updateOrgLogo(null);
  }

  async function handleCancelInvitation(invitationId: string) {
    try {
      const result = await authClient.organization.cancelInvitation({ invitationId });
      if (result.error) {
        toast.error(localizeError(result.error, t("Failed to cancel invitation")));
        return;
      }
      toast.success(t("Invitation cancelled"));
      if (activeOrg) {
        await queryClient.invalidateQueries({
          queryKey: ["team", "organization", currentUserId, activeOrg.id],
        });
      }
    } catch (error) {
      console.error("Failed to cancel invitation", error);
      toast.error(t("Failed to cancel invitation"));
    }
  }

  function clearLinkedInvitation(invitationId: string) {
    queryClient.setQueryData<ReceivedInvitation | null>(
      ["team", "linked-invitation", currentUserId, linkedInvitationId],
      (current) => (current?.id === invitationId ? null : current),
    );
  }

  async function handleAcceptMyInvitation(invitationId: string) {
    await runWithLoading(
      (loading) => setRespondingInvitationId(loading ? invitationId : null),
      async () => {
        try {
          const result = await authClient.organization.acceptInvitation({ invitationId });
          if (result.error) {
            toast.error(localizeError(result.error, t("Failed to accept invitation")));
            return;
          }
          toast.success(t("Invitation accepted"));
          clearLinkedInvitation(invitationId);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["team", "organizations", currentUserId] }),
            queryClient.invalidateQueries({ queryKey: ["team", "my-invitations", currentUserId] }),
            session.refetch(),
          ]);
        } catch (error) {
          console.error("Failed to accept invitation", error);
          toast.error(t("Failed to accept invitation"));
        }
      },
    );
  }

  async function handleRejectMyInvitation(invitationId: string) {
    await runWithLoading(
      (loading) => setRespondingInvitationId(loading ? invitationId : null),
      async () => {
        try {
          const result = await authClient.organization.rejectInvitation({ invitationId });
          if (result.error) {
            toast.error(localizeError(result.error, t("Failed to decline invitation")));
            return;
          }
          toast.success(t("Invitation declined"));
          clearLinkedInvitation(invitationId);
          await queryClient.invalidateQueries({
            queryKey: ["team", "my-invitations", currentUserId],
          });
        } catch (error) {
          console.error("Failed to decline invitation", error);
          toast.error(t("Failed to decline invitation"));
        }
      },
    );
  }

  async function handleDeleteOrg() {
    if (!activeOrg) return;
    const deletedOrgId = activeOrg.id;
    await runWithLoading(setIsDeletingOrg, async () => {
      try {
        const result = await authClient.organization.delete({ organizationId: deletedOrgId });
        if (result.error) {
          toast.error(localizeError(result.error, t("Failed to delete team")));
          return;
        }
        toast.success(t("Team deleted"));
        setIsDeleteDialogOpen(false);
        setSelectedOrgId(null);
        queryClient.setQueryData<Organization[]>(
          ["team", "organizations", currentUserId],
          (current) => (current ?? []).filter((org) => org.id !== deletedOrgId),
        );
        queryClient.removeQueries({
          queryKey: ["team", "organization", currentUserId, deletedOrgId],
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["team", "organizations", currentUserId] }),
          session.refetch(),
        ]);
      } catch (error) {
        console.error("Failed to delete team", error);
        toast.error(t("Failed to delete team"));
      }
    });
  }

  async function handleSubscribe(planId: TeamPlanId) {
    if (!activeOrg) return;
    try {
      const result = await createTeamCheckout.mutateAsync({
        organizationId: activeOrg.id,
        planId,
      });
      startTransition(() => {
        push(`/settings/team/checkout/${result.sessionId}?organizationId=${activeOrg.id}`);
      });
    } catch (error) {
      console.error("Failed to create checkout session", error);
      toast.error(localizeError(error, t("Unable to load checkout.")));
    }
  }

  // "Switch" only opens the confirmation: the change is invoiced for every seat at once.
  function handleChangePlan(planId: TeamPlanId) {
    setHasAgreedToTeamPlanChange(false);
    setPendingTeamPlanId(planId);
  }

  function handleChangePlanDialogOpenChange(open: boolean) {
    if (changeTeamPlan.isPending || open) return;
    setPendingTeamPlanId(null);
    setHasAgreedToTeamPlanChange(false);
  }

  async function confirmChangePlan() {
    if (!activeOrg || !pendingTeamPlanId) return;
    try {
      await changeTeamPlan.mutateAsync({
        organizationId: activeOrg.id,
        planId: pendingTeamPlanId,
      });
      toast.success(t("Team plan updated."));
      await Promise.all([
        utils.organization.teamBillingStatus.invalidate({ organizationId: activeOrg.id }),
        utils.organization.teamPlans.invalidate(),
        utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id }),
        utils.billing.maxModeStatus.invalidate(),
        utils.billing.status.invalidate(),
        utils.billing.usage.invalidate(),
      ]);
    } catch (error) {
      console.error("Failed to change team plan", error);
      toast.error(localizeError(error, t("Failed to change team plan.")));
    } finally {
      setPendingTeamPlanId(null);
      setHasAgreedToTeamPlanChange(false);
    }
  }

  async function handleManage() {
    if (!activeOrg) return;
    try {
      const result = await createPortal.mutateAsync({
        organizationId: activeOrg.id,
      });
      if (result.url) {
        window.location.href = result.url;
      } else {
        toast.error(t("Stripe did not return a billing portal URL."));
      }
    } catch (error) {
      console.error("Failed to open portal", error);
      toast.error(t("Failed to open billing portal"));
    }
  }

  async function handleCancel() {
    setShredOpen(true);
  }

  async function confirmCancel() {
    if (!activeOrg) {
      throw new Error(t("Failed to cancel subscription"));
    }
    const result = await cancelSub.mutateAsync({ organizationId: activeOrg.id });
    utils.organization.teamBillingStatus.setData({ organizationId: activeOrg.id }, (current) =>
      current
        ? {
            ...current,
            status: result.status ?? "canceled",
            cancelAt: result.cancelAt ?? current.cancelAt,
            currentPeriodEnd: result.currentPeriodEnd ?? current.currentPeriodEnd,
          }
        : current,
    );
    await Promise.all([
      utils.organization.teamBillingStatus.invalidate({ organizationId: activeOrg.id }),
      utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id }),
      utils.billing.maxModeStatus.invalidate(),
      utils.billing.usage.invalidate(),
      utils.billing.status.invalidate(),
    ]);
  }

  async function handleResume() {
    if (!activeOrg) return;
    try {
      await resumeSub.mutateAsync({ organizationId: activeOrg.id });
      toast.success(t("Subscription resumed."));
      await Promise.all([
        utils.organization.teamBillingStatus.invalidate({ organizationId: activeOrg.id }),
        utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id }),
        utils.billing.status.invalidate(),
        utils.billing.maxModeStatus.invalidate(),
        utils.billing.usage.invalidate(),
      ]);
    } catch (error) {
      console.error("Failed to resume", error);
      toast.error(t("Failed to resume subscription"));
    }
  }

  async function handleTeamMaxModeToggle(enabled: boolean) {
    if (!activeOrg) return;
    try {
      await updateTeamMaxMode.mutateAsync({ organizationId: activeOrg.id, enabled });
      toast.success(enabled ? t("Max Mode enabled.") : t("Max Mode disabled."));
      await Promise.all([
        utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id }),
        utils.billing.maxModeStatus.invalidate(),
        utils.billing.usage.invalidate(),
      ]);
    } catch (error) {
      console.error("Failed to update team Max Mode", error);
      toast.error(localizeError(error, t("Failed to update Max Mode.")));
    }
  }

  async function updateMemberPolicy(input: {
    userId: string;
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
  }) {
    if (!activeOrg) return;
    try {
      await updateMemberMaxModePolicy.mutateAsync({
        organizationId: activeOrg.id,
        ...input,
      });
      await Promise.all([
        utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id }),
        utils.billing.maxModeStatus.invalidate(),
        utils.billing.usage.invalidate(),
      ]);
      toast.success(t("Member Max Mode policy updated."));
    } catch (error) {
      console.error("Failed to update member Max Mode policy", error);
      toast.error(localizeError(error, t("Failed to update Max Mode.")));
    }
  }

  async function updateDefaultPolicy(input: {
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
  }) {
    if (!activeOrg) return;
    try {
      await updateTeamMaxModeDefaultPolicy.mutateAsync({
        organizationId: activeOrg.id,
        ...input,
      });
      await utils.organization.teamMaxModeSettings.invalidate({ organizationId: activeOrg.id });
      toast.success(t("Default Max Mode policy updated."));
    } catch (error) {
      console.error("Failed to update default Max Mode policy", error);
      toast.error(localizeError(error, t("Failed to update Max Mode.")));
    }
  }

  async function handleDefaultLimitChange({
    maxModeEnabled,
    maxModeLimitBasic,
    maxModeLimitPremium,
    category,
    value,
  }: {
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
    category: "basic" | "premium";
    value: string;
  }) {
    const parsedLimit = parseTokenLimit(value);
    if (parsedLimit === undefined) {
      toast.error(t("Enter a whole number or leave the field blank."));
      return;
    }
    // Focusing and leaving the field must not save (or audit-log) an unchanged value.
    if (parsedLimit === (category === "basic" ? maxModeLimitBasic : maxModeLimitPremium)) return;

    await updateDefaultPolicy({
      maxModeEnabled,
      maxModeLimitBasic: category === "basic" ? parsedLimit : maxModeLimitBasic,
      maxModeLimitPremium: category === "premium" ? parsedLimit : maxModeLimitPremium,
    });
  }

  async function handleMemberLimitChange({
    userId,
    maxModeEnabled,
    maxModeLimitBasic,
    maxModeLimitPremium,
    category,
    value,
  }: {
    userId: string;
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
    category: "basic" | "premium";
    value: string;
  }) {
    const parsedLimit = parseTokenLimit(value);
    if (parsedLimit === undefined) {
      toast.error(t("Enter a whole number or leave the field blank."));
      return;
    }
    if (parsedLimit === (category === "basic" ? maxModeLimitBasic : maxModeLimitPremium)) return;

    await updateMemberPolicy({
      userId,
      maxModeEnabled,
      maxModeLimitBasic: category === "basic" ? parsedLimit : maxModeLimitBasic,
      maxModeLimitPremium: category === "premium" ? parsedLimit : maxModeLimitPremium,
    });
  }

  function handleExportMaxModeCsv() {
    const settings = teamMaxModeQuery.data;
    if (!settings || !activeOrg) return;

    const headers = [
      "name",
      "email",
      "role",
      "max_mode_enabled",
      "basic_token_limit",
      "premium_token_limit",
      "basic_tokens_used",
      "premium_tokens_used",
    ];
    const rows = settings.members.map((memberPolicy) => [
      memberPolicy.name ?? "",
      memberPolicy.email,
      memberPolicy.role,
      memberPolicy.maxModeEnabled ? "enabled" : "disabled",
      memberPolicy.maxModeLimitBasic ?? "",
      memberPolicy.maxModeLimitPremium ?? "",
      memberPolicy.maxModeUsageBasic,
      memberPolicy.maxModeUsagePremium,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeOrg.slug ?? activeOrg.id}-max-mode.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const isLoading = session.isPending || (organizationsLoading && organizations.length === 0);
  const teamPlans = teamPlansQuery.data?.plans ?? [];

  return {
    t,
    isLoading,
    organizations,
    activeOrg,
    members,
    reloadMembers,
    isReloadingMembers,
    isMembersReloadCoolingDown,
    pendingInvitations,
    myPendingInvitations,
    respondingInvitationId,
    isOwner,
    isAdmin,
    teamBillingQuery,
    teamMaxModeQuery,
    teamPlans,
    createTeamCheckout,
    changeTeamPlan,
    pendingTeamPlanId,
    teamPlanEstimateQuery,
    isChangePlanDialogOpen,
    hasAgreedToTeamPlanChange,
    setHasAgreedToTeamPlanChange,
    cancelSub,
    resumeSub,
    updateTeamMaxMode,
    updateTeamMaxModeDefaultPolicy,
    updateMemberMaxModePolicy,
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    newOrgName,
    setNewOrgName,
    isCreatingOrg,
    isInviteDialogOpen,
    setIsInviteDialogOpen,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    isInviting,
    memberToRemove,
    setMemberToRemove,
    isRemovingMember,
    orgNameDraft,
    setOrgNameDraft,
    isSavingOrgName,
    isSavingOrgLogo,
    selectOrg,
    handleCreateOrg,
    handleUpdateOrgName,
    handleUpdateOrgLogo,
    handleRemoveOrgLogo,
    handleInvite,
    handleRemoveMember,
    updatingMemberRoleId,
    handleUpdateMemberRole,
    handleCancelInvitation,
    handleAcceptMyInvitation,
    handleRejectMyInvitation,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDeletingOrg,
    handleDeleteOrg,
    handleSubscribe,
    handleChangePlan,
    handleChangePlanDialogOpenChange,
    confirmChangePlan,
    handleManage,
    handleCancel,
    confirmCancel,
    shredOpen,
    setShredOpen,
    handleResume,
    handleTeamMaxModeToggle,
    updateMemberPolicy,
    updateDefaultPolicy,
    handleDefaultLimitChange,
    handleMemberLimitChange,
    handleExportMaxModeCsv,
  };
}
