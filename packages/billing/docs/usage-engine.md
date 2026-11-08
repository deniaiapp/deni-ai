# Usage engine: Deni AI chat and Flixa

Deni AI chat (`apps/web`) and Flixa (`services/agent-api`) spend one monthly
usage pool per account, stored in `public.usage_quota`. Until phase P3 of the
monorepo plan two implementations wrote that table. This document maps both
flows and lists every behavioural difference between them; it is the reference
for the shared engine (`@deniai/billing/server`, `createUsageEngine`) and for the
agent API's `FLIXA_USAGE_ENGINE` rollout switch.

- **Web engine** (now `packages/billing/src/server/usage-engine.ts`, formerly
  `apps/web/src/lib/usage.ts`): Drizzle, a per-user row lock, receipts in
  `public.usage_reservation`, team usage policy, Max Mode credits, stale
  reservation recovery, guests, the usage summary and the product ledger.
- **Legacy Flixa path** (`services/agent-api/utils/deni/usage.ts`, kept for
  `FLIXA_USAGE_ENGINE=legacy` and `shadow`): raw SQL, a lock-free conditional
  upsert, receipts in `flixa.usage_reservation` (deprecated), and its own usage
  summary (`getDeniUsageInfo`).

## Shared ground (identical in both)

| Aspect                 | Rule                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                   | Usage units (`@deniai/billing`): 1M units = $0.50. Chat and Flixa spend weighted tokens times the model's usage tier multiplier; Deni Run spends provider cost (`product_usage`, product `run`, micro-dollars, 1 micro-dollar = 2 units, `Math.round`).                             |
| Pool size              | `USAGE_POOL_USD` per tier (Free $10, Go $30, Plus $100, Pro $200); Free with a verified card $15; Free flagged at sign-up (`signup_risk`) $2 until a card is verified.                                                                                                              |
| Category               | Every request is recorded on the `basic` row (`getModelCategory` in the agent API always returns `basic`); `premium` rows from before 2026-11 still count against the pool.                                                                                                         |
| Limit of a category    | Pool minus the live use of the other category row minus Deni Run's spend this UTC month, floored at 0.                                                                                                                                                                              |
| Period                 | UTC calendar month. A quota row resets when `period_end <= now` (`period_end` = first instant of next UTC month) or when its `unit` is not `units`; the new `period_start` is the request time.                                                                                     |
| Education              | A verified, non-anonymous address on an allowed educational domain lifts Free to Go (paid and team plans take precedence).                                                                                                                                                          |
| Estimate               | Flixa reserves `UsageEstimate.reservationAmount` (input bytes / 4 plus the forwarded output limit or the model's max output, weighted and multiplied) before the upstream call, in both modes.                                                                                      |
| Metered amount         | Flixa settles `computeMeteredTokens(usageWithFallback(usage))` times the token multiplier and long-context multiplier, `Math.ceil`, in both modes.                                                                                                                                  |
| Abort / upstream error | Same route logic in both modes: an upstream rejection before the response refunds the whole hold (settle 0); a client abort or an upstream stream error after the response started charges the observed input and output estimate; a completed stream charges the provider's usage. |
| Ledger                 | Settling records the settled amount in `product_usage` (metric = category, unit `units`, period = UTC month of the reservation's creation); a zero amount writes nothing.                                                                                                           |
| Limit response         | Flixa answers HTTP 429 `USAGE_LIMIT_EXCEEDED` with `category`, `tier`, `canVerifyForBoost`, `canUpgrade`, `verifyUrl`, `upgradeUrl` in both modes (`@deniai/flixa-contract`).                                                                                                       |

## Behavioural differences (legacy Flixa vs web engine)

| #   | Area              | Legacy Flixa path                                                                                                                                                                                                                               | Web engine (now shared)                                                                                                                                                                                                                                                                                             |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Concurrency       | Lock-free: one `INSERT … ON CONFLICT DO UPDATE … WHERE used + amount <= limit` plus the receipt in one statement.                                                                                                                               | Read-committed transaction holding `SELECT … FROM "user" … FOR UPDATE`; several reads (billing, team policy, credits, quota, ledger, reservation totals) then the upsert and the receipt. More round trips per request.                                                                                             |
| 2   | Active statuses   | `active`, `trialing`, `past_due`, `incomplete`, `unpaid`, `paid` (plus `canceled` before period end).                                                                                                                                           | `active`, `trialing`, `past_due`, `paid` (plus `canceled` before period end). `incomplete`/`unpaid` plans count as Free.                                                                                                                                                                                            |
| 3   | Plan id to tier   | Prefixes: `pro*` → Pro, `plus*` → Plus, `go_*` → Go, else Free; any active team row → Pro.                                                                                                                                                      | Exact plan ids (`PLAN_FAMILY_BY_ID`); unknown ids → Free; team plans → Pro. Same result for every current plan id.                                                                                                                                                                                                  |
| 4   | Team billing row  | The highest-priority row of any `pro_team%` organization the user belongs to.                                                                                                                                                                   | Only the organization's canonical row (oldest `created_at`, then `id`), first one that is active or in grace.                                                                                                                                                                                                       |
| 5   | Verified card     | `payment_method_fingerprint IS NOT NULL` on the chosen billing row (the team row for team members). Removed cards still count.                                                                                                                  | The personal row's fingerprint and no `card_removed_at`.                                                                                                                                                                                                                                                            |
| 6   | Sign-up flag      | Always read; a failed query fails the request.                                                                                                                                                                                                  | Read only for unverified Free accounts; a failed lookup counts as not flagged.                                                                                                                                                                                                                                      |
| 7   | Billing cache     | Tier and card state cached 60 s (`FLIXA_BILLING_CACHE_TTL_MS`).                                                                                                                                                                                 | Read fresh inside the lock on every reservation. (The agent API still uses the cached profile for model access and the 429 `tier` field.)                                                                                                                                                                           |
| 8   | Tier change       | Changing `plan_tier` resets the quota row to 0 (usage starts over on upgrade/downgrade).                                                                                                                                                        | The row keeps its usage; only the period or unit resets it.                                                                                                                                                                                                                                                         |
| 9   | Max Mode          | Ignored: a request past the pool is refused. `/v1/deni/usage` reports `maxModeEligible` = `pro*` plan and `active`, `maxModeEnabled` = that and `billing.max_mode_enabled`.                                                                     | Past the pool, a request is allowed when Max Mode is on (any paid plan with status `active`, `billing.max_mode_enabled`, team member enabled) and the owner has unexpired credits covering this request's overage; settlement spends credits (the team's on team plans). `maxModeEnabled` is false without credits. |
| 10  | Team usage policy | Ignored.                                                                                                                                                                                                                                        | `team_member_usage_policy` (else `team_usage_policy` defaults): Max Mode on/off per member and a cap on the member's period overage (`max_mode_limit_basic`); a request whose overage would exceed the cap is refused, settlement never spends past it.                                                             |
| 11  | Deletion pending  | Ignored.                                                                                                                                                                                                                                        | `billing.deletion_pending` refuses new reservations (`Account deletion is in progress.`; Flixa answers it with the 429 body).                                                                                                                                                                                       |
| 12  | Guests            | Rejected before usage (403 `guest_account`).                                                                                                                                                                                                    | 1M-unit allowance that never resets. Not reachable from Flixa (guest keys stay rejected).                                                                                                                                                                                                                           |
| 13  | Reserve writes    | `usage_quota` upsert (`plan_tier`, `limit_amount`, `unit`, `used`, period; `updated_at` untouched) and `flixa.usage_reservation` (`id`, `user_id`, `category`, `plan_tier`, `period_start` as epoch text, `amount`).                            | `usage_quota` upsert (same columns plus `updated_at`) and `public.usage_reservation` (category, product, unit, period, reserved amount, `base_used`, limit, Max Mode flag and cap, billing id, Stripe customer).                                                                                                    |
| 14  | Settle            | Deletes the receipt; `used = GREATEST(0, used - reserved + actual)` only if the row's `plan_tier`, `unit` and `period_start` still match; inserts the `product_usage` row (product `flixa`). Exactly once through the delete.                   | Under the lock: marks the receipt settled (`settled_amount`, `max_mode_amount`, `settled_at`); same `used` adjustment if `unit`, `period_start`, `period_end` match; `product_usage` row with the reservation's product; credits spent for overage; then the auto top-up hook. Exactly once through `settled_at`.   |
| 15  | Settle failure    | The receipt stays; the full estimate stays charged with no reconciliation job.                                                                                                                                                                  | The reservation stays unsettled; the host's recovery is scheduled 15 min later (`scheduleRecovery`).                                                                                                                                                                                                                |
| 16  | Crash mid-request | Full estimate charged forever, orphaned receipt.                                                                                                                                                                                                | `observed_amount` is refreshed every 30 s while a request runs (`recordObservedUsage`); after 15 min of silence `recoverUsageReservations` settles at the observed amount (an abandoned estimate is never billed).                                                                                                  |
| 17  | Auto top-up       | n/a                                                                                                                                                                                                                                             | After credits are spent the host's `autoTopUp` hook may charge the saved card (web: Stripe). The agent API has no Stripe client: Flixa settlements spend credits without triggering a top-up (see Open points).                                                                                                     |
| 18  | Summary           | `getDeniUsageInfo`: pool = live `basic` + `premium` rows (rows reset by a tier change count 0) + Deni Run; per-entry `periodStart` from each row.                                                                                               | `getUsageSummary`: pool = live quota rows + Deni Run, split into chat/Flixa by the product ledger; one `periodStart`. The agent API maps it to the same contract shape (`pool`, two legacy `usage` entries).                                                                                                        |
| 19  | Reservation id    | Random UUID.                                                                                                                                                                                                                                    | Caller-chosen text id; idempotent replay of the same id and amount. Flixa uses `flixa:<uuid>`.                                                                                                                                                                                                                      |
| 20  | Allowance         | None (the stream is not cut at the pool).                                                                                                                                                                                                       | `allowance` = pool left plus credits within the cap; the web chat stops a generation there. Flixa does not cut streams in either mode; a settlement past the pool records all usage and the next request is refused.                                                                                                |
| 21  | Timestamp parsing | Reads `usage_quota.period_start`/`period_end` (`timestamp` without time zone) through `pg`'s default parser, i.e. in the Node process's local zone: `/v1/deni/usage` dates and the "row is current" check shift unless the process runs in UTC. | Drizzle reads them as UTC regardless of the process zone. Same result in UTC containers (production).                                                                                                                                                                                                               |

## Lifecycle on the shared engine

| Step      | Web chat                                                                           | Flixa (`FLIXA_USAGE_ENGINE=shared`)                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reserve   | `consumeUsage({ category: "basic", reservationId: "<generation>:model", amount })` | `validateAgentAuth` → `consumeUsage({ category: "basic", product: "flixa", reservationId: "flixa:<uuid>", amount: estimate })`; `UsageLimitError` → 429 body above |
| Heartbeat | `recordObservedUsage` every 30 s                                                   | `startUsageLease`: every 30 s, the metered amount of the observed input and output so far (a crash before the first heartbeat is recovered at 0), until settlement |
| Settle    | `settleUsage({ amount })` at the end of the stream                                 | `finalizeUsage` / `releaseReservedUsage` → `settleUsage({ amount })` once per request                                                                              |
| Failure   | Recovery job (`/api/cron/usage-and-meter` or in-process scheduler)                 | Same table, so the web job recovers Flixa reservations; the agent API also schedules its own recovery run after a failed settlement                                |

## Rollout switch (agent API)

`FLIXA_USAGE_ENGINE`:

- `shared` (default): reserve, settle, recover and `/v1/deni/usage` through the
  engine. `flixa.usage_reservation` is not written.
- `legacy`: the previous raw-SQL path, kept for rollback.
- `shadow`: legacy is authoritative and writes. Before each legacy reservation
  the engine runs the same reservation in a transaction that is always rolled
  back, and a difference in the allow/deny decision or the remaining amount is
  logged as a structured warning (`flixa_usage_shadow_mismatch`). Nothing is
  written twice. A dry run that fails (for example before migration 0075) is
  logged as `flixa_usage_shadow_error` and never blocks the request.

`shared` is the default in this repository (the trial). A production rollout
should set `FLIXA_USAGE_ENGINE=shadow` explicitly first (see Open points).

Costs of `shared`: about ten queries in one transaction per reservation (tier,
team policy, credits, quota rows, Deni Run ledger, reservation totals, upsert,
receipt) instead of one statement plus a cached billing profile, and the user's
row lock serializes that user's concurrent reservations and settlements (as in
the web chat). `shadow` adds the dry run before every legacy reservation.

Unchanged in every mode: model access (`tier_restricted`), the client access
policy and the 429 body's `tier` / `canVerifyForBoost` still come from the agent
API's cached billing profile (legacy tier rules, differences 2 to 7).

## `flixa.usage_reservation` (deprecated)

Only `legacy` and `shadow` write it; the schema (`@deniai/db/flixa`) marks it
`@deprecated`. Nothing was dropped. A later cleanup, once `shared` has run in
production and no unsettled receipts remain, would:

1. Check `SELECT count(*) FROM flixa.usage_reservation` is 0 (receipts left by a
   crash still hold their whole estimate in `usage_quota`: refund or keep them
   deliberately, provider work may have completed).
2. Remove the legacy path (`reserveUsageQuota`, `settleUsageQuota`,
   `getDeniUsageInfo`) and the `FLIXA_USAGE_ENGINE` switch.
3. Add a flixa migration with `DROP TABLE "flixa"."usage_reservation";` (remove
   the table from `packages/db/src/flixa/schema.ts` and run
   `pnpm --filter @deniai/db db:generate:flixa`).

## Schema change

`public.usage_reservation` gained a `product` column so settlement and recovery
record the right ledger (`packages/db/migrations/0075_usage_reservation_product.sql`,
additive, not applied by this change):

```sql
ALTER TABLE "usage_reservation" ADD COLUMN "product" text DEFAULT 'chat' NOT NULL;
```

Existing rows are chat reservations, so the default is correct for them; with a
constant default the statement does not rewrite the table.

## Open points before production

1. Apply migration `0075_usage_reservation_product` (`public`) to each
   environment before deploying the agent API with `shared` or `shadow`. The web
   app writes the column too, so deploy the web app after the migration as well.
2. Deploy the agent API with `FLIXA_USAGE_ENGINE=shadow` and review
   `flixa_usage_shadow_mismatch` / `flixa_usage_shadow_error` for a period; the
   expected mismatches are the intended differences above (Max Mode, tier change,
   incomplete/unpaid statuses, team billing row, card state, deletion pending).
3. Switch production to `shared`; keep `legacy` for rollback for one release.
4. Auto top-up for Flixa-only spenders: give the agent API a top-up hook (for
   example an internal web endpoint) or let the web job check balances below
   their threshold.
5. Decide whether model access and the 429 `tier` should follow the engine's
   tier rules (one tier derivation for the whole agent API).
6. Cleanup of `flixa.usage_reservation` and the legacy path (section above).
