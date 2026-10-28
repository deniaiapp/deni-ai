import { Zap } from "lucide-react";
import { useExtracted } from "use-intl";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import {
  MaxModeCreditsPanel,
  type MaxModeAutoTopUpSettings,
  type MaxModeCreditSummaryData,
} from "./max-mode-credits-panel";

type MaxModeData = {
  eligible: boolean;
  enabled: boolean;
  isTeam: boolean;
  canManage: boolean;
  credits: MaxModeCreditSummaryData | null;
  packs: readonly number[];
  minCredits: number;
  maxCredits: number;
};

export function BillingMaxModeCard({
  data,
  onToggle,
  isToggling,
  onBuy,
  buyPending,
  onSaveAutoTopUp,
  autoTopUpPending,
}: {
  data: MaxModeData;
  onToggle: (enabled: boolean) => void;
  isToggling: boolean;
  onBuy: (credits: number, saveCard: boolean) => void;
  buyPending: boolean;
  onSaveAutoTopUp: (settings: MaxModeAutoTopUpSettings) => void;
  autoTopUpPending: boolean;
}) {
  const t = useExtracted();

  return (
    <Card className="border-border/80">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{t("Max Mode")}</CardTitle>
            {data.enabled && <Badge variant="secondary">{t("Active")}</Badge>}
          </div>
          <CardDescription>
            {data.isTeam
              ? t("Keep using Deni AI past your plan's limits with your team's prepaid credits.")
              : t("Keep using Deni AI past your plan's limits with prepaid credits.")}
          </CardDescription>
        </div>
        {data.canManage && (
          <div className="flex items-center gap-2">
            <Label htmlFor="max-mode-toggle" className="text-sm text-muted-foreground">
              {data.enabled ? t("Enabled") : t("Disabled")}
            </Label>
            <Switch
              id="max-mode-toggle"
              checked={data.enabled}
              onCheckedChange={onToggle}
              disabled={isToggling || (!data.enabled && !data.eligible)}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {data.isTeam && !data.canManage && (
          <p className="text-sm text-muted-foreground">
            {t("Your team owner buys and manages the team's Max Mode credits.")}
          </p>
        )}
        <MaxModeCreditsPanel
          credits={data.credits}
          packs={data.packs}
          minCredits={data.minCredits}
          maxCredits={data.maxCredits}
          canManage={data.canManage && data.eligible}
          buyPending={buyPending}
          onBuy={onBuy}
          autoTopUpPending={autoTopUpPending}
          onSaveAutoTopUp={onSaveAutoTopUp}
        />
      </CardContent>
    </Card>
  );
}
