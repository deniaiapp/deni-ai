# @deniai/billing

Billing rules shared by Deni AI chat (`apps/web`) and Flixa
(`services/agent-api`): the pure rules both apps (and Deni Run) compute with, and
the one usage engine that writes `usage_quota`.

| Export                    | What it is                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@deniai/billing`         | Pure, isomorphic: pool sizes (`USAGE_POOL_USD`, verified/flagged Free pools, `usdToUsageUnits`), plan ids and tiers (`getPlanTier`, `PLAN_FAMILY_BY_ID`, `ACTIVE_BILLING_STATUSES`), Max Mode eligibility (`isMaxModeEligible`, `MAX_MODE_USABLE_STATUSES`), usage tier multipliers, token weights, education domains, the UTC usage month (`usageMonthStart`, `usageMonthEnd`). |
| `@deniai/billing/server`  | Server only (`drizzle-orm`, `@deniai/db`): `createUsageEngine(deps)` and its types, `UsageLimitError`, `USAGE_RESERVATION_STALE_MS`, `SHARED_USAGE_CATEGORY`, `GUEST_USAGE_LIMITS`, `getUsagePoolUnits`; the Max Mode credit lots (`getMaxModeCreditUnits`, `spendMaxModeCredits`, `creditOwnerFor`), `recordProductUsage`, `isSignupFlagged`, `canonicalTeamBillingRow`.        |
| `@deniai/billing/testing` | Tests only: PGlite with the real `public` migrations (`createUsageTestDb`) and fixtures (users, billing, teams, member policies, credit lots, Deni Run spend) plus readers for quota, reservations, the ledger and credits. Never import it from production code.                                                                                                                |

## The usage engine

`createUsageEngine(deps)` returns `consumeUsage` (reserve; `dryRun` rolls it
back), `settleUsage`, `recordObservedUsage` (heartbeat / recovery lease),
`recoverUsageReservations`, `getUsageSummary`, `getUsageSummaryDetails`,
`getSubscriptionTier`, `hasEducationGo`, `isFreeAdViewer` and `canCompareModels`.
It covers the shared monthly pool, guests, team usage policy, Max Mode credits,
reservation recovery and the per-product ledger (`product_usage`, product `chat`
or `flixa` from the reservation).

The package never imports an app. `deps` carries what differs per host:

| Dep                                                                                              | apps/web                                                       | services/agent-api                     |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------- |
| `db`                                                                                             | postgres.js Drizzle (`@/db/drizzle`)                           | node-postgres Drizzle on the `pg` pool |
| `billingDisabled`                                                                                | `platformCapabilities` billing switch                          | `false`                                |
| `scheduleRecovery(at)`                                                                           | `requestUsageAndMeterCheck` (usage and meter job)              | in-process timer running recovery      |
| `autoTopUp(owner, now)`                                                                          | Stripe off-session top-up                                      | none (no Stripe client)                |
| `getPlanTier`, `isMaxModeEligible`, `maxModeUsableStatuses`, `isSignupFlagged`, `maxModeCredits` | its own modules (they re-export this package; tests mock them) | defaults from this package             |
| `clock`, `logger`                                                                                | defaults                                                       | defaults                               |

`apps/web/src/lib/usage.ts` is the web app's composition root;
`services/agent-api/utils/deni/usageEngine.ts` the agent API's. The flows, the
differences from the agent API's legacy path and the `FLIXA_USAGE_ENGINE`
rollout are in [docs/usage-engine.md](docs/usage-engine.md).

`drizzle-orm` is a peer dependency: hosts must resolve the same copy as
`@deniai/db` (pnpm does for the workspace today).

Scripts: `typecheck`, `lint`, `format`, `format:check`, `test` (vitest; the engine
tests run on PGlite with the real migrations).
