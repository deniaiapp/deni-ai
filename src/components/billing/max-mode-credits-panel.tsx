import { useState } from "react";
import { CalendarCheck, CreditCard, RefreshCw } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import { formatAppDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";

type DateLike = Date | string;

export type MaxModeCreditSummaryData = {
  balanceCredits: number;
  usedCreditsThisMonth: number;
  nextExpiry: { credits: number; expiresAt: DateLike } | null;
  lots: {
    id: string;
    source: string;
    grantedCredits: number;
    remainingCredits: number;
    expiresAt: DateLike;
    createdAt: DateLike;
    expired: boolean;
  }[];
  autoTopUp: {
    enabled: boolean;
    thresholdCredits: number;
    amountCredits: number;
    hasPaymentMethod: boolean;
    lastError: string | null;
  };
};

export type MaxModeAutoTopUpSettings = {
  enabled: boolean;
  thresholdCredits: number;
  amountCredits: number;
};

const AUTO_TOP_UP_THRESHOLD_MAX = 100;

function useFormatCredits() {
  const locale = useLocale();
  // One credit is $1 of usage, so balances read as dollar amounts.
  return (credits: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(credits);
}

export function MaxModeCreditsPanel({
  credits,
  packs,
  minCredits,
  maxCredits,
  canManage,
  buyPending,
  onBuy,
  autoTopUpPending,
  onSaveAutoTopUp,
}: {
  credits: MaxModeCreditSummaryData | null | undefined;
  packs: readonly number[];
  minCredits: number;
  maxCredits: number;
  canManage: boolean;
  buyPending: boolean;
  onBuy: (credits: number, saveCard: boolean) => void;
  autoTopUpPending: boolean;
  onSaveAutoTopUp: (settings: MaxModeAutoTopUpSettings) => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const formatCredits = useFormatCredits();
  const [selected, setSelected] = useState<number>(packs[1] ?? packs[0] ?? minCredits);
  const [custom, setCustom] = useState("");
  const [saveCard, setSaveCard] = useState(false);
  const customAmount = custom.trim() === "" ? null : Number(custom);
  const amount = customAmount ?? selected;
  const amountValid = Number.isInteger(amount) && amount >= minCredits && amount <= maxCredits;
  const formatDate = (value: DateLike) =>
    formatAppDate(value, locale, { year: "numeric", month: "short", day: "numeric" });
  const recentLots = credits?.lots.slice(0, 5) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <div className="text-sm text-muted-foreground">{t("Credit balance")}</div>
          <div className="mt-1 text-2xl font-semibold">
            {formatCredits(credits?.balanceCredits ?? 0)}
          </div>
          {credits?.nextExpiry && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarCheck className="size-3" />
              {t("{amount} expires on {date}", {
                amount: formatCredits(credits.nextExpiry.credits),
                date: formatDate(credits.nextExpiry.expiresAt),
              })}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="text-sm text-muted-foreground">{t("Used this month")}</div>
          <div className="mt-1 text-2xl font-semibold">
            {formatCredits(credits?.usedCreditsThisMonth ?? 0)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("1 credit = $1 of usage past your plan's monthly pool")}
          </p>
        </div>
      </div>

      {canManage && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CreditCard className="size-4 text-muted-foreground" />
            {t("Buy credits")}
          </div>
          <div className="flex flex-wrap gap-2">
            {packs.map((pack) => (
              <Button
                key={pack}
                type="button"
                size="sm"
                variant={customAmount === null && selected === pack ? "default" : "outline"}
                onClick={() => {
                  setSelected(pack);
                  setCustom("");
                }}
              >
                {formatCredits(pack)}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="max-mode-custom-credits" className="text-xs text-muted-foreground">
                {t("Custom amount ({min}–{max} credits)", {
                  min: String(minCredits),
                  max: String(maxCredits),
                })}
              </Label>
              <Input
                id="max-mode-custom-credits"
                inputMode="numeric"
                type="number"
                min={minCredits}
                max={maxCredits}
                step={1}
                value={custom}
                placeholder={String(selected)}
                onChange={(event) => setCustom(event.target.value)}
                aria-invalid={customAmount !== null && !amountValid}
              />
            </div>
            <Button
              type="button"
              disabled={!amountValid || buyPending}
              onClick={() => onBuy(amount, saveCard)}
            >
              {buyPending && <Spinner />}
              {t("Buy {amount}", { amount: formatCredits(amountValid ? amount : 0) })}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="max-mode-save-card"
              checked={saveCard}
              onCheckedChange={(checked) => setSaveCard(checked === true)}
            />
            <Label htmlFor="max-mode-save-card" className="text-xs text-muted-foreground">
              {t("Save this card for auto top-up")}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Credits expire 180 days after purchase and are not refundable once used.")}
          </p>
        </div>
      )}

      {canManage && credits && (
        <AutoTopUpForm
          key={`${credits.autoTopUp.enabled}:${credits.autoTopUp.thresholdCredits}:${credits.autoTopUp.amountCredits}`}
          settings={credits.autoTopUp}
          minCredits={minCredits}
          maxCredits={maxCredits}
          pending={autoTopUpPending}
          onSave={onSaveAutoTopUp}
        />
      )}

      {recentLots.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <div className="text-sm font-medium">{t("Recent purchases")}</div>
          <ul className="space-y-1.5">
            {recentLots.map((lot) => (
              <li
                key={lot.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 text-xs",
                  lot.expired && "text-muted-foreground line-through",
                )}
              >
                <span>
                  {lot.source === "auto_top_up" ? t("Auto top-up") : t("Purchase")} ·{" "}
                  {formatCredits(lot.grantedCredits)} · {formatDate(lot.createdAt)}
                </span>
                <span className="text-muted-foreground">
                  {t("{remaining} left · expires {date}", {
                    remaining: formatCredits(lot.remainingCredits),
                    date: formatDate(lot.expiresAt),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AutoTopUpForm({
  settings,
  minCredits,
  maxCredits,
  pending,
  onSave,
}: {
  settings: MaxModeCreditSummaryData["autoTopUp"];
  minCredits: number;
  maxCredits: number;
  pending: boolean;
  onSave: (settings: MaxModeAutoTopUpSettings) => void;
}) {
  const t = useExtracted();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [threshold, setThreshold] = useState(String(settings.thresholdCredits));
  const [amount, setAmount] = useState(String(settings.amountCredits));
  const thresholdValue = Number(threshold);
  const amountValue = Number(amount);
  const valid =
    Number.isInteger(thresholdValue) &&
    thresholdValue >= 1 &&
    thresholdValue <= AUTO_TOP_UP_THRESHOLD_MAX &&
    Number.isInteger(amountValue) &&
    amountValue >= minCredits &&
    amountValue <= maxCredits &&
    amountValue >= thresholdValue;
  const changed =
    enabled !== settings.enabled ||
    thresholdValue !== settings.thresholdCredits ||
    amountValue !== settings.amountCredits;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <RefreshCw className="size-4 text-muted-foreground" />
          {t("Auto top-up")}
        </div>
        <Switch
          aria-label={t("Auto top-up")}
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={pending}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="max-mode-top-up-threshold" className="text-xs text-muted-foreground">
            {t("When the balance falls below (credits)")}
          </Label>
          <Input
            id="max-mode-top-up-threshold"
            type="number"
            inputMode="numeric"
            min={1}
            max={AUTO_TOP_UP_THRESHOLD_MAX}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="max-mode-top-up-amount" className="text-xs text-muted-foreground">
            {t("Buy this many credits")}
          </Label>
          <Input
            id="max-mode-top-up-amount"
            type="number"
            inputMode="numeric"
            min={minCredits}
            max={maxCredits}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>
      {!valid && (
        <p className="text-xs text-destructive">
          {t(
            "Choose a threshold of 1–{threshold} and an amount of {min}–{max} that is at least the threshold.",
            {
              threshold: String(AUTO_TOP_UP_THRESHOLD_MAX),
              min: String(minCredits),
              max: String(maxCredits),
            },
          )}
        </p>
      )}
      {settings.lastError && (
        <p className="text-xs text-destructive">
          {t("The last auto top-up failed and auto top-up was turned off: {error}", {
            error: settings.lastError,
          })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {settings.hasPaymentMethod
            ? t("Charges the card saved at a credit purchase.")
            : t("Charges your plan's card. Save a card at a credit purchase to use another one.")}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!valid || !changed || pending}
          onClick={() =>
            onSave({ enabled, thresholdCredits: thresholdValue, amountCredits: amountValue })
          }
        >
          {pending && <Spinner />}
          {t("Save")}
        </Button>
      </div>
    </div>
  );
}
