import { db } from "@/db/drizzle";
import { getPlanTier } from "@/lib/billing";
import { isSignupFlagged } from "@/lib/signup-risk";
import { createUsageEngine } from "@deniai/billing/server";

import { isBillingDisabled } from "./billing-config";
import { isMaxModeEligible, MAX_MODE_USABLE_STATUSES } from "./max-mode";
import {
  creditOwnerFor,
  getMaxModeCreditUnits,
  maybeAutoTopUpMaxModeCredits,
  spendMaxModeCredits,
} from "./max-mode-credits";
import { requestUsageAndMeterCheck } from "./usage-and-meter-schedule";

/**
 * The usage engine (reserve, settle, recover, summary, team policy, Max Mode, product
 * ledger) lives in `@deniai/billing/server` and is shared with Flixa
 * (services/agent-api). This module binds it to this app's database, billing switch,
 * Max Mode credits, auto top-up and recovery job.
 */
const engine = createUsageEngine({
  db,
  billingDisabled: isBillingDisabled,
  logger: console,
  scheduleRecovery: (at) => requestUsageAndMeterCheck(at),
  autoTopUp: (owner, now) => maybeAutoTopUpMaxModeCredits(owner, now),
  getPlanTier: (planId) => getPlanTier(planId),
  isMaxModeEligible: (planId) => isMaxModeEligible(planId),
  maxModeUsableStatuses: MAX_MODE_USABLE_STATUSES,
  isSignupFlagged: (userId, database) => isSignupFlagged(userId, database),
  maxModeCredits: {
    creditOwnerFor: (record) => creditOwnerFor(record),
    getCreditUnits: (owner, now, database) => getMaxModeCreditUnits(owner, now, database),
    spend: (owner, units, now, database) => spendMaxModeCredits(owner, units, now, database),
  },
});

export {
  getUsagePoolUnits,
  SHARED_USAGE_CATEGORY,
  USAGE_RESERVATION_STALE_MS,
  UsageLimitError,
  type SubscriptionTier,
  type UsageCategory,
  type UsagePeriod,
  type UsagePoolSnapshot,
  type UsageSnapshot,
  type UsageSummary,
  type UsageUnit,
} from "@deniai/billing/server";

/** Usage units charged per successful `search` tool call. */
export const SEARCH_TOOL_USAGE_COST = 10_000;

export const {
  consumeUsage,
  settleUsage,
  recordObservedUsage,
  recoverUsageReservations,
  getUsageSummary,
  getSubscriptionTier,
  hasEducationGo,
  isFreeAdViewer,
  canCompareModels,
} = engine;
