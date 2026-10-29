import { Download, ShieldCheck, Zap } from "lucide-react";
import { useExtracted } from "use-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  MaxModeCreditsPanel,
  type MaxModeAutoTopUpSettings,
  type MaxModeCreditSummaryData,
} from "@/components/billing/max-mode-credits-panel";
import { TeamMaxModeDefaultPolicySection } from "./team-max-mode-default-policy";
import { TeamMaxModeMemberRow, type TeamMaxModeMemberPolicy } from "./team-max-mode-member-row";

type DefaultPolicy = {
  maxModeEnabled: boolean;
  maxModeLimitBasic: number | null;
  maxModeLimitPremium: number | null;
};

type MaxModeSettings = {
  enabled: boolean;
  eligible: boolean;
  credits: MaxModeCreditSummaryData;
  packs: readonly number[];
  minCredits: number;
  maxCredits: number;
  defaultPolicy?: DefaultPolicy | null;
  members: TeamMaxModeMemberPolicy[];
};

export function TeamMaxModeCard({
  isLoading,
  settings,
  teamTogglePending,
  defaultPolicyPending,
  memberPolicyPending,
  onTeamToggle,
  onDefaultPolicyChange,
  onDefaultLimitChange,
  onMemberPolicyChange,
  onMemberLimitChange,
  onExportCsv,
  buyPending,
  onBuy,
  autoTopUpPending,
  onSaveAutoTopUp,
}: {
  isLoading: boolean;
  settings?: MaxModeSettings | null;
  teamTogglePending: boolean;
  defaultPolicyPending: boolean;
  memberPolicyPending: boolean;
  onTeamToggle: (enabled: boolean) => void;
  onDefaultPolicyChange: (input: {
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
  }) => void;
  onDefaultLimitChange: (input: {
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
    category: "basic" | "premium";
    value: string;
  }) => void;
  onMemberPolicyChange: (input: {
    userId: string;
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
  }) => void;
  onMemberLimitChange: (input: {
    userId: string;
    maxModeEnabled: boolean;
    maxModeLimitBasic: number | null;
    maxModeLimitPremium: number | null;
    category: "basic" | "premium";
    value: string;
  }) => void;
  onExportCsv: () => void;
  buyPending: boolean;
  onBuy: (credits: number, saveCard: boolean) => void;
  autoTopUpPending: boolean;
  onSaveAutoTopUp: (settings: MaxModeAutoTopUpSettings) => void;
}) {
  const t = useExtracted();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-primary" />
              {t("Team Max Mode")}
            </CardTitle>
            <CardDescription>
              {t(
                "Buy shared prepaid credits for usage past the plan's pool, and set per-member limits.",
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!settings} onClick={onExportCsv}>
              <Download className="size-3.5" />
              {t("Export CSV")}
            </Button>
            <Switch
              aria-label={t("Enable Max Mode for the team")}
              checked={settings?.enabled ?? false}
              disabled={isLoading || !settings?.eligible || teamTogglePending}
              onCheckedChange={onTeamToggle}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Spinner />
        ) : (
          <>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">{t("Status")}</p>
              <p className="mt-1 text-sm font-medium">
                {settings?.enabled ? t("Enabled") : t("Disabled")}
              </p>
            </div>

            {settings && (
              <MaxModeCreditsPanel
                credits={settings.credits}
                packs={settings.packs}
                minCredits={settings.minCredits}
                maxCredits={settings.maxCredits}
                canManage={settings.eligible}
                buyPending={buyPending}
                onBuy={onBuy}
                autoTopUpPending={autoTopUpPending}
                onSaveAutoTopUp={onSaveAutoTopUp}
              />
            )}

            {settings?.defaultPolicy && (
              <TeamMaxModeDefaultPolicySection
                policy={settings.defaultPolicy}
                disabled={isLoading || defaultPolicyPending}
                onPolicyChange={onDefaultPolicyChange}
                onLimitChange={onDefaultLimitChange}
              />
            )}

            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_88px_120px] gap-3 px-3 text-xs font-medium text-muted-foreground md:grid">
                <span>{t("Member")}</span>
                <span>{t("Enabled")}</span>
                <span>{t("Unit limit")}</span>
              </div>
              {settings?.members.map((memberPolicy) => (
                <TeamMaxModeMemberRow
                  key={memberPolicy.userId}
                  memberPolicy={memberPolicy}
                  disabled={isLoading || memberPolicyPending}
                  onPolicyChange={onMemberPolicyChange}
                  onLimitChange={onMemberLimitChange}
                />
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <p>
                {t(
                  "Limits are in usage units past the plan's pool (2M units = 1 credit). Blank limits let a member spend the team's credits freely while the team switch is enabled.",
                )}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
