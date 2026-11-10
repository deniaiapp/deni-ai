import { useExtracted } from "use-intl";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { SettingsPageShell } from "../settings-page-shell";
import { CardVerificationCard } from "./card-verification-card";
import { BillingChangePlanDialog } from "./billing-change-plan-dialog";
import { BillingCurrentPlanCard } from "./billing-current-plan-card";
import { BillingFlashOfferBanner } from "./billing-flash-offer-banner";
import { BillingMaxModeCard } from "./billing-max-mode-card";
import { BillingPlansSection } from "./billing-plans-section";
import { BillingResetCard } from "./billing-reset-card";
import { BillingUsageSummary } from "./billing-usage-section";
import { SubscriptionShredder } from "./subscription-shredder";
import { useBillingPage } from "./use-billing-page";
import { Card, CardDescription, CardHeader, CardTitle } from "@deniai/ui/components/card";
import {
  PageSection,
  PageSectionContent,
  PageSectionDescription,
  PageSectionHeader,
  PageSectionTitle,
} from "@deniai/ui/components/page-section";
import { Spinner } from "@deniai/ui/components/spinner";

function BillingDisabled() {
  const t = useExtracted();

  return (
    <SettingsPageShell
      title={t("Billing")}
      description={t("Billing is disabled for this environment.")}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("Billing unavailable")}</CardTitle>
          <CardDescription>
            {t("Plans, checkout, and billing management are turned off.")}
          </CardDescription>
        </CardHeader>
      </Card>
    </SettingsPageShell>
  );
}

function BillingPageContent() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const {
    activePlanId,
    usageItem,
    cancel,
    cancelFeedback,
    cancelDate,
    cancelReceipt,
    changePlan,
    changeTarget,
    createCheckout,
    currentPlan,
    disableMaxMode,
    enableMaxMode,
    estimateQuery,
    errored,
    flashOffer,
    handleCancelClick,
    handleChangePlanClick,
    handleCheckout,
    handleConfirmChangePlan,
    handleDialogOpenChange,
    handleMaxModeToggle,
    hasActiveSubscription,
    hasAgreed,
    isChangePlanOpen,
    isEducation,
    isOnTeamPlan,
    isSubscribed,
    goMonthly,
    loading,
    maxModeQuery,
    buyMaxModeCredits,
    updateMaxModeAutoTopUp,
    pendingPlanId,
    planInterval,
    plusMonthly,
    portal,
    proMonthly,
    rawPlanId,
    resume,
    selectedPlusPlan,
    selectedProPlan,
    setHasAgreed,
    setPlanInterval,
    setShredOpen,
    showYearlyPlans,
    shredOpen,
    statusQuery,
    usageQuery,
    usageTier,
  } = useBillingPage();

  const title = t("Billing");

  if (loading) {
    return (
      <SettingsPageShell title={title} width="wide">
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title={title} width="wide">
      {flashOffer && (
        <BillingFlashOfferBanner
          limit={flashOffer.limit}
          percentOff={flashOffer.percentOff}
          isUpTo={flashOffer.isUpTo}
          onViewOffer={showYearlyPlans}
        />
      )}

      <PageSection layout="stacked">
        <PageSectionHeader>
          <PageSectionTitle>{t("Overview")}</PageSectionTitle>
        </PageSectionHeader>
        <PageSectionContent>
          <BillingCurrentPlanCard
            isEducation={isEducation}
            isOnTeamPlan={isOnTeamPlan}
            rawPlanId={rawPlanId}
            currentPlan={currentPlan}
            activePlanId={activePlanId}
            cancelDate={cancelDate}
            currentPeriodEnd={statusQuery.data?.currentPeriodEnd}
            stripeCustomerId={statusQuery.data?.stripeCustomerId}
            hasActiveSubscription={hasActiveSubscription}
            portalPending={portal.isPending}
            cancelPending={cancel.isPending || shredOpen}
            resumePending={resume.isPending}
            onPortal={() => portal.mutate()}
            onCancel={handleCancelClick}
            onResume={() => resume.mutate()}
          >
            <BillingUsageSummary
              isLoading={usageQuery.isLoading}
              errorMessage={usageQuery.error ? localizeError(usageQuery.error) : undefined}
              usageItem={usageItem}
              maxModeEnabled={maxModeQuery.data?.enabled}
              pool={usageQuery.data?.pool}
            />
          </BillingCurrentPlanCard>
          {/* Free plan only: a verified card raises the Free allowance. */}
          <CardVerificationCard
            isFreeTier={usageTier === "free"}
            hasVerifiedPaymentMethod={usageQuery.data?.hasVerifiedPaymentMethod ?? false}
            signupLimited={usageQuery.data?.signupLimited ?? false}
          />
        </PageSectionContent>
      </PageSection>

      <PageSection layout="stacked">
        <PageSectionHeader>
          <PageSectionTitle>{t("Extra usage")}</PageSectionTitle>
          <PageSectionDescription>
            {t("Ways to keep going when this month's usage runs low.")}
          </PageSectionDescription>
        </PageSectionHeader>
        {/* Two columns once the section is wide enough; a last card on its own spans both. */}
        <PageSectionContent className="@container/extras">
          <div className="grid items-start gap-4 @3xl/extras:grid-cols-2 @3xl/extras:[&>*:last-child:nth-child(odd)]:col-span-2">
            <BillingResetCard />
            {maxModeQuery.data?.eligible && (
              <BillingMaxModeCard
                data={maxModeQuery.data}
                onToggle={handleMaxModeToggle}
                isToggling={enableMaxMode.isPending || disableMaxMode.isPending}
                onBuy={(credits, saveCard) => buyMaxModeCredits.mutate({ credits, saveCard })}
                buyPending={buyMaxModeCredits.isPending || buyMaxModeCredits.isSuccess}
                onSaveAutoTopUp={(settings) => updateMaxModeAutoTopUp.mutate(settings)}
                autoTopUpPending={updateMaxModeAutoTopUp.isPending}
              />
            )}
          </div>
        </PageSectionContent>
      </PageSection>

      <BillingPlansSection
        erroredMessage={errored?.message}
        hasActiveSubscription={hasActiveSubscription}
        goMonthly={goMonthly}
        selectedPlusPlan={selectedPlusPlan}
        plusMonthly={plusMonthly}
        selectedProPlan={selectedProPlan}
        proMonthly={proMonthly}
        interval={planInterval}
        onIntervalChange={setPlanInterval}
        isOnTeamPlan={isOnTeamPlan}
        isEducation={isEducation}
        planActions={{
          activePlanId,
          isSubscribed,
          hasActiveSubscription,
          isOnTeamPlan,
          pendingPlanId,
          isEstimateLoading: estimateQuery.isLoading,
          cancelDate,
          changePlan,
          checkout: createCheckout,
          onChangePlanClick: handleChangePlanClick,
          onCheckout: handleCheckout,
        }}
      />

      <BillingChangePlanDialog
        open={isChangePlanOpen}
        onOpenChange={handleDialogOpenChange}
        changeTarget={changeTarget}
        estimate={estimateQuery}
        hasAgreed={hasAgreed}
        onHasAgreedChange={setHasAgreed}
        isPending={changePlan.isPending}
        onConfirm={handleConfirmChangePlan}
      />

      <SubscriptionShredder
        data={cancelReceipt}
        onClose={() => setShredOpen(false)}
        onConfirm={async () => {
          await cancel.mutateAsync({ feedback: cancelFeedback });
        }}
        open={shredOpen}
      />
    </SettingsPageShell>
  );
}

export function BillingPage() {
  const { features } = usePlatformCapabilities();

  if (!features.billing) {
    return <BillingDisabled />;
  }

  return <BillingPageContent />;
}
