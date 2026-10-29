import { CheckCircle2, Copy, Globe, Trash2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { useExtracted } from "use-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { Link } from "@/lib/navigation";
import { TEAM_DOMAIN_JOIN_MODES, type TeamDomainJoinMode } from "@/lib/team-domain-policy";
import { trpc } from "@/lib/trpc/react";
import type { AppRouter } from "@/server/api/root";
import { useTeamSettingsContext } from "./team-settings-context";

type TeamDomain = inferRouterOutputs<AppRouter>["teamDomains"]["settings"]["domains"][number];

function CopyableValue({ label, value }: { label: string; value: string }) {
  const t = useExtracted();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        aria-label={t("Copy")}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => toast.success(t("Copied to clipboard.")),
            () => toast.error(t("Could not copy to the clipboard.")),
          );
        }}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

function TeamDomainsPaidNotice() {
  const t = useExtracted();
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t(
            "Team domains are available on a paid team plan. Domains you already added stop applying until the plan is active again.",
          )}
        </p>
        <Button
          size="sm"
          variant="outline"
          render={<Link href="/settings/team/billing" />}
          nativeButton={false}
        >
          {t("View plans")}
        </Button>
      </CardContent>
    </Card>
  );
}

function TeamDomainRow({
  domain,
  canEdit,
  isVerifying,
  isVerifyDisabled,
  isRemoveDisabled,
  onVerify,
  onRemove,
}: {
  domain: TeamDomain;
  canEdit: boolean;
  isVerifying: boolean;
  isVerifyDisabled: boolean;
  isRemoveDisabled: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const t = useExtracted();
  const isVerified = Boolean(domain.verifiedAt);
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{domain.domain}</p>
          {isVerified ? (
            <Badge variant="secondary" className="shrink-0">
              <CheckCircle2 data-icon="inline-start" />
              {t("Verified")}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              {t("Pending verification")}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isVerified && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || isVerifyDisabled}
              onClick={onVerify}
            >
              {isVerifying && <Spinner data-icon="inline-start" />}
              {t("Verify")}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-destructive hover:text-destructive"
            aria-label={t("Remove domain")}
            disabled={isRemoveDisabled}
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {!isVerified && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t(
              "Add this TXT record at your DNS provider, then select Verify. You can remove the record after the domain is verified.",
            )}
          </p>
          <CopyableValue label={t("Name")} value={domain.txtRecord.name} />
          <CopyableValue label={t("Value")} value={domain.txtRecord.value} />
        </div>
      )}
    </div>
  );
}

function TeamDomainsCard({
  organizationId,
  domains,
  canEdit,
}: {
  organizationId: string;
  domains: TeamDomain[];
  canEdit: boolean;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const [domainDraft, setDomainDraft] = useState("");
  const invalidate = () => utils.teamDomains.settings.invalidate({ organizationId });

  const addDomain = trpc.teamDomains.addDomain.useMutation({
    onSuccess: async () => {
      setDomainDraft("");
      await invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });
  const verifyDomain = trpc.teamDomains.verifyDomain.useMutation({
    onSuccess: async ({ verified }) => {
      if (verified) {
        toast.success(t("Domain verified."));
        await invalidate();
      } else {
        toast.error(
          t(
            "The TXT record was not found yet. DNS changes can take a while to appear; try again later.",
          ),
        );
      }
    },
    onError: (error) => toast.error(localizeError(error)),
  });
  const removeDomain = trpc.teamDomains.removeDomain.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(localizeError(error)),
  });

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!domainDraft.trim()) return;
    addDomain.mutate({ organizationId, domain: domainDraft });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-4" />
          {t("Email domains")}
        </CardTitle>
        <CardDescription>
          {t(
            "Verify a domain your organization owns. Its addresses can then sign up even if the domain is not normally allowed, and join this team according to the setting below.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={domainDraft}
            onChange={(event) => setDomainDraft(event.target.value)}
            placeholder={t("example.com")}
            aria-label={t("Domain")}
            autoComplete="off"
            disabled={!canEdit}
          />
          <Button type="submit" disabled={!canEdit || addDomain.isPending || !domainDraft.trim()}>
            {addDomain.isPending && <Spinner data-icon="inline-start" />}
            {t("Add domain")}
          </Button>
        </form>

        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No domains yet.")}</p>
        ) : (
          <div className="space-y-2">
            {domains.map((domain) => (
              <TeamDomainRow
                key={domain.id}
                domain={domain}
                canEdit={canEdit}
                isVerifying={
                  verifyDomain.isPending && verifyDomain.variables?.domainId === domain.id
                }
                isVerifyDisabled={verifyDomain.isPending}
                isRemoveDisabled={removeDomain.isPending}
                onVerify={() => verifyDomain.mutate({ organizationId, domainId: domain.id })}
                onRemove={() => removeDomain.mutate({ organizationId, domainId: domain.id })}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamDomainJoinModeCard({
  organizationId,
  joinMode,
  canEdit,
}: {
  organizationId: string;
  joinMode: TeamDomainJoinMode;
  canEdit: boolean;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const updateJoinMode = trpc.teamDomains.updateJoinMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Joining setting saved."));
      await utils.teamDomains.settings.invalidate({ organizationId });
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const joinModeLabels: Record<TeamDomainJoinMode, string> = {
    auto: t("Join automatically"),
    request: t("Suggest and require admin approval"),
    off: t("Off"),
  };
  const joinModeDescriptions: Record<TeamDomainJoinMode, string> = {
    auto: t(
      "People who sign in with a verified domain email join the team as members. Each one adds a billed seat, and an active personal subscription is canceled.",
    ),
    request: t(
      "People who sign in with a verified domain email see this team and can ask to join. An owner or admin approves each request on the Members page.",
    ),
    off: t(
      "Nobody joins through the domain. Its addresses can still sign up and be invited as usual.",
    ),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Joining by domain")}</CardTitle>
        <CardDescription>
          {t("Choose what happens when someone signs in with a verified domain email.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="team-domain-join-mode">{t("When they sign in")}</FieldLabel>
          <Select
            value={joinMode}
            disabled={!canEdit || updateJoinMode.isPending}
            onValueChange={(value) => {
              if (value) {
                updateJoinMode.mutate({ organizationId, joinMode: value as TeamDomainJoinMode });
              }
            }}
          >
            <SelectTrigger id="team-domain-join-mode" className="w-full sm:w-80">
              <SelectValue>{joinModeLabels[joinMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TEAM_DOMAIN_JOIN_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {joinModeLabels[mode]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{joinModeDescriptions[joinMode]}</FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}

export function TeamDomainsPage() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const { activeOrg, isAdmin, isRoleLoading } = useTeamSettingsContext();
  const organizationId = activeOrg?.id ?? "";

  const settingsQuery = trpc.teamDomains.settings.useQuery(
    { organizationId },
    { enabled: Boolean(activeOrg) && isAdmin },
  );

  if (!activeOrg) return null;

  if (isRoleLoading || (isAdmin && settingsQuery.isLoading)) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Only team owners and admins can manage domains.")}
      </p>
    );
  }

  if (settingsQuery.error || !settingsQuery.data) {
    return (
      <p className="text-sm text-destructive">
        {settingsQuery.error ? localizeError(settingsQuery.error) : null}
      </p>
    );
  }

  const settings = settingsQuery.data;
  const canEdit = settings.isPaid;

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <TeamDomainsPaidNotice />}
      <TeamDomainsCard
        organizationId={organizationId}
        domains={settings.domains}
        canEdit={canEdit}
      />
      <TeamDomainJoinModeCard
        organizationId={organizationId}
        joinMode={settings.joinMode}
        canEdit={canEdit}
      />
    </div>
  );
}
