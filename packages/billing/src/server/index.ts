/**
 * `@deniai/billing/server`: the usage engine shared by Deni AI chat (apps/web) and
 * Flixa (services/agent-api). Server-only: it imports `drizzle-orm` and the
 * `@deniai/db` schema; hosts pass their database and services into
 * {@link createUsageEngine}. See ../../docs/usage-engine.md.
 */
export type { UsageEngineDatabase, UsageEngineLogger, UsageQueryDatabase } from "./database";
export {
  creditOwnerFor,
  getMaxModeCreditUnits,
  maxModeCreditLotOwnerCondition,
  spendMaxModeCredits,
  type MaxModeCreditDatabase,
  type MaxModeCreditOwner,
} from "./max-mode-credits";
export {
  recordProductUsage,
  type ProductUsageDatabase,
  type UsageProduct,
} from "./product-usage-ledger";
export { isSignupFlagged } from "./signup-risk";
export { canonicalTeamBillingRow } from "./team-billing";
export {
  createUsageEngine,
  getUsagePoolUnits,
  GUEST_USAGE_LIMITS,
  RUN_COST_METRICS,
  SHARED_USAGE_CATEGORY,
  USAGE_RESERVATION_STALE_MS,
  UsageLimitError,
  type RunBudget,
  type RunCostMetric,
  type SubscriptionTier,
  type TierInfo,
  type UsageCategory,
  type UsageEngine,
  type UsageEngineDeps,
  type UsagePeriod,
  type UsagePoolSnapshot,
  type UsageReservationProduct,
  type UsageReservationResult,
  type UsageSnapshot,
  type UsageSummary,
  type UsageSummaryDetails,
  type UsageUnit,
} from "./usage-engine";
