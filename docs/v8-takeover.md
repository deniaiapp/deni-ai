# Deni AI v8 takeover of deniai.app

How v8 (this monorepo, `apps/web`) replaces v7 (the `deni-ai` repository) at
`deniai.app`. The takeover is done: v8 serves `deniai.app`, and the percentage
rollout Worker (`services/rollout-router`) and the private beta gate
(`BETA_ACCESS_REQUIRED`, the `beta_access` table, `/private-beta`) have been removed
from the code. The steps below that mention them are kept as a record. Both apps already
share the production Postgres database, the R2 bucket and `BETTER_AUTH_SECRET`, so
the takeover moves **traffic and background work**, not data.

Both apps run on minidock (see the minidock repository's `docs/server.md`):
`deni-ai` (v7, branch `master`, `Dockerfile`) serves `deniai.app`, and
`deni-ai-beta` (v8, branch `beta/v8`, `apps/web/Dockerfile`) serves
`beta.deniai.app`. Caddy routes by host name only, and moving a host name from one
app to another leaves a few seconds of 404, so the takeover **switches the
`deni-ai` app itself to v8** and deploys it; the health check guards the switch.

After the takeover:

- `deniai.app` (the `deni-ai` app) serves v8, which runs the scheduled jobs and the
  Stripe webhook.
- `beta.deniai.app` redirects to `deniai.app`, and the rollout Worker is removed.
- v7's last image stays in the `deni-ai` app's deployments for the rollback window.

## What changes and what does not

| Area                        | At takeover                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions                    | Kept. v7 and v8 use Better Auth's default cookie names, the same `session` table and the same `BETTER_AUTH_SECRET`, so a v7 session on `deniai.app` keeps working on v8. Sessions created on `beta.deniai.app` are host-only and do not follow the redirect: beta testers sign in again. |
| Passkeys                    | Kept. They are bound to `deniai.app` (`PASSKEY_RP_ID=deniai.app` on the beta, and the auth URL's host after takeover).                                                                                                                                                              |
| Password-only accounts      | v8 asks accounts that sign in only with a password to turn on two-factor authentication (`src/lib/two-factor-policy.ts`), which v7 did not. Announce it.                                                                                                                             |
| Guests                      | Allowed again once `BETA_ACCESS_REQUIRED` is off; the guest cleanup job then runs on v8.                                                                                                                                                                                            |
| Stripe webhook              | The endpoint stays `https://deniai.app/api/stripe/webhook`, so nothing changes in Stripe. v8 needs v7's `STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_ENABLED` unset (default `true`).                                                                                                  |
| Scheduled jobs              | `usage-and-meter`, `storage-cleanup`, `guest-cleanup` and `model-health` move to v8 (`CRON_ENABLED` unset). They are safe to run concurrently, so a short overlap with v7 while switching is harmless; a long one is not needed.                                                     |
| Deni AI as OAuth provider   | Flixa and Deni AI Desktop keep `deniai.app` as issuer and redirect target. The OAuth clients, consents and JWKS are rows in the shared database, so they keep working. Standalone Deni Run (`run.deniai.app`) is retired and replaced by built-in Run mode (`docs/run-migration.md`).                 |
| Flixa                       | The production API stays the Flixa backend (`deniaiapp/flixa`, `apps/backend`), but it must run a build with the billing-cycle usage period (see Usage period and plan changes below) from the moment v8 serves everyone. `services/agent-api` stays undeployed (or `FLIXA_USAGE_ENGINE=shadow`). |
| Run mode (`/run`)           | The beta runs with `RUN_ENABLED=false`. Turning it on opens Run to everyone and needs its background work: `RUN_SCHEDULER_IN_PROCESS=true` on the single web instance (plus `RUN_DISCORD_ENABLED=true` for the bot), or `services/run-worker`. Cut over legacy D1 data and redirect `run.deniai.app` per `docs/run-migration.md`. |
| Beta-only UI                | Removed: the sidebar "Beta" label, the account menu's "Go to Deni AI v7", "Switch to the previous version" and "Send feedback" items, `/private-beta` and Settings → Beta testers. |
| Retired pages               | guides, use cases, about and models answer 308 permanent redirects (`apps/web/vite/route-rules.ts`). Canonical URLs already use `https://deniai.app`.                                                                                                                                                   |
| Google sign-in, Turnstile   | No change: `deniai.app` is already registered.                                                                                                                                                                                                                                      |
| GitHub sign-in              | Switch back to v7's GitHub OAuth App (callback on `deniai.app`). Accounts are matched by GitHub user id, so links made on beta keep working.                                                                                                                                        |

## Usage period and plan changes

v8 and the Flixa backend reset a paid plan's usage pool with its billing cycle
(`packages/billing/docs/usage-engine.md`, Usage period); v7 resets every pool on the
first of the UTC month. All three write the same `usage_quota` and `product_usage`
rows, so they only agree once v7 is gone:

- **Deploy together**: the v8 web app with that change and the Flixa backend build
  with the same rule go out with the takeover (the Flixa backend first is fine: its
  rule only differs for rows v8 has not touched yet). Do not ship the change to v8
  weeks before the takeover: while v7 still serves some sessions, a paying account
  that uses both versions gets extra resets at the month's end, and usage recorded
  through v7 (chat, standalone Deni Run) is keyed by calendar month and is not
  counted in v8's pool.
- **One reset for paying accounts**: their quota rows still end on the first of the
  next month, which no longer matches their billing period, so each starts a new pool
  the first time it is used after the deploy. Free accounts are unaffected.
- **Plan changes**: v8 applies an upgrade at once with a new billing cycle and
  schedules a downgrade for the end of the paid period in a Stripe subscription
  schedule (`apps/web/SETUP.md`). v7 knows nothing about schedules: Stripe refuses
  v7's "cancel subscription" on a subscription with a pending downgrade, and v7 never
  shows or drops the pending change.

## Before the day

1. **Code for the release** (lands on `canary`, promoted to `master`):
   - The 8.0 codename and release date are set in `apps/web/src/lib/version.ts`
     (Crimson Blade, 2026-11-19; the changelog entry reads both). Change `appDate` if
     the takeover happens on another day.
   - The 8.0 entry in `apps/web/src/lib/changelog.ts` (English and `ja`) is written as
     a release describing unified Deni Run built into Deni AI.
   - Finish or leave out unfinished work; release from a clean, verified `canary`.
2. **Beta health**: no open Sentry issue on v8 that v7 does not have; Free testers'
   usage pool and everyone's Max Mode numbers agree between v7 and v8 (a paid plan's
   pool differs by design once v8 has the billing-cycle usage period); no `run_jobs`
   stuck in `running`.
3. **Run background work**: on the single v8 instance set `RUN_SCHEDULER_IN_PROCESS=true`
   (and `RUN_DISCORD_ENABLED=true` with `DISCORD_BOT_TOKEN` for the bot), or deploy
   `services/run-worker` (`services/run-worker/README.md`), or keep `RUN_ENABLED=false`.
4. **Announce**: the new design, Run mode, the two-factor requirement for
   password-only accounts, and that beta testers sign in again on `deniai.app`.
5. **Rehearse** the env below on the beta deployment where it does not change the
   origin (for example run one beta instance with `CRON_ENABLED` unset while v7 has
   `DISABLE_BACKGROUND_JOBS=1`) if you want to see the jobs on v8 first.

## On the day

1. **Back up the production database** (`pg_dump -Fc` or a Neon branch); note its name
   and time and confirm it restores.
2. **Check migrations**: the newest applied migration is the newest file in
   `packages/db/migrations/` (`0081` at the time of writing). Apply missing ones from
   this repository first (`pnpm --filter @deniai/db db:migrate` with the production
   `DATABASE_URL`).
3. **Deploy the Flixa backend** build with the billing-cycle usage period
   (`deniaiapp/flixa`, `apps/backend`), so it and v8 agree on the usage period from
   the first request.
4. **Save v7's configuration**: copy the `deni-ai` app's Environment, Build-time
   Arguments, branch and Dockerfile path somewhere safe. A minidock rollback starts
   the old image with the **current** Environment, so going back to v7 needs them.
5. **Switch the `deni-ai` app to v8** in the minidock panel: branch `beta/v8` (or
   `master` once v8 is promoted there), Dockerfile `apps/web/Dockerfile`, the
   Build-time Arguments of `deni-ai-beta` with
   `NEXT_PUBLIC_BETTER_AUTH_URL=https://deniai.app` (and the other `NEXT_PUBLIC_*`
   values as for v7), and v7's production Environment except:

   | Variable                                              | Value at takeover                                                         |
   | ----------------------------------------------------- | ------------------------------------------------------------------------- |
   | `BETTER_AUTH_URL`                                     | `https://deniai.app`                                                      |
   | `BETA_ACCESS_REQUIRED`, `BETA_ACCESS_PAID_PLANS`      | Unset (no longer read)                                                    |
   | `CRON_ENABLED`, `STRIPE_WEBHOOK_ENABLED`              | Unset (default `true`)                                                    |
   | `STRIPE_WEBHOOK_SECRET`                               | v7's value                                                                |
   | `NOINDEX`                                             | Unset                                                                     |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`            | v7's GitHub OAuth App                                                     |
   | `PASSKEY_RP_ID`                                       | `deniai.app` or unset (the auth URL's host)                               |
   | `RUN_SCHEDULER_IN_PROCESS`, `RUN_ENABLED`             | `true` / unset once Run should run; until then `RUN_ENABLED=false`        |
   | `ROLLOUT_SWITCH_ENABLED`, `NEXT_PUBLIC_V7_URL`        | Unset (no longer read)                                                    |
   | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `R2_*`          | Unchanged (already v7's)                                                  |

   Then press **Deploy**. Once the health check passes, `deniai.app` serves v8 and the
   v7 container is gone, so only v8 runs the jobs and receives the webhook.
6. **Remove the rollout Worker** if it runs: set `V8_PERCENT=0` (everything then
   reaches the `deni-ai` app, now v8), then delete the Worker's `deniai.app/*` route.
   Visitors' `deni_variant` cookies are ignored from then on.
7. **Retire the beta host**: stop the `deni-ai-beta` app and add a Cloudflare
   redirect rule from `beta.deniai.app/*` to the same path on `deniai.app` (Caddy
   cannot redirect).
8. **Smoke test** on `deniai.app`:
   - An existing v7 session is still signed in; email, Google, GitHub and passkey
     sign-in work; a guest can start a chat.
   - A chat streams and its usage appears in Settings → Billing. On a paid account
     the usage card's reset date is the plan's renewal day, not the first of the month,
     and Flixa (`flixa usage`) reports the same pool and date.
   - In Stripe test mode or on your own subscription: the change-plan dialog shows
     the full-price estimate for an upgrade and the effective date for a downgrade,
     and a scheduled downgrade appears on the plan card with **Keep current plan**.
   - Stripe: send a test webhook from the dashboard (or watch the next real event)
     and check it answers 2xx from v8.
   - Logs show the in-process jobs starting (`usage-and-meter`, `storage-cleanup`,
     `guest-cleanup`, `model-health`); `/api/status/models` returns results.
   - Flixa sign-in and `/run` built-in Run mode work (unless Run is off until the D1
     migration and `run.deniai.app` cutover in `docs/run-migration.md` complete).
   - The sidebar has no "Beta" label and the account menu no "Go to Deni AI v7".
9. **Watch** for the first days: Sentry, Stripe webhook delivery failures, the
   background job warnings (`Background job ... reported failures` / `is stuck`), and
   E2B / Steel spend.

## Rollback

Every v8 migration is additive and v8 keeps writing `chats.messages`, so v7 still works
against the database:

1. Restore v7's saved configuration on the `deni-ai` app (Environment, Build-time
   Arguments, branch `master`, Dockerfile `Dockerfile`), then either **Rollback** to
   the last v7 deployment (its image is kept while it is among the last three
   successful ones) or **Deploy** to build v7 again. Restore the Environment first: a
   rollback runs the old image with the current Environment.
2. If v8 should stay reachable, start `deni-ai-beta` again with the beta env
   (`CRON_ENABLED=false`, `STRIPE_WEBHOOK_ENABLED=false`, `NOINDEX=1`, the beta GitHub
   OAuth App, `NEXT_PUBLIC_BETTER_AUTH_URL` rebuilt for beta) and remove the beta
   redirect rule. The private beta gate no longer exists, so that deployment is open
   to every account.

What v7 cannot show: Run mode data, per-account preferred models and the per-chat
model (`0081`). Accounts that turned on two-factor authentication on v8 keep it on v7.

Usage and plans after a rollback: v7 resets pools by calendar month again, so a paying
account's row (ending with its billing period) is reset once more at that period's
end and then follows the month; nothing is lost, usage is only forgiven. Roll the
Flixa backend back to its calendar-month build as well, or the two disagree. Downgrades
scheduled on v8 stay in Stripe and still switch the price at the period end, but v7
does not show them and cannot cancel such a subscription (Stripe refuses it while the
schedule is attached): release the schedule in the Stripe dashboard for a customer who
asks.

## After the takeover

- Retire the beta deployment and the beta GitHub OAuth App once the redirect has
  served for a while.
- Until the rollback window ends, keep schema changes v7 depends on additive so v7
  can still take traffic back (dropping v8-only tables such as `beta_access` is fine).
- v7's repository stops receiving feature work; model updates land here only.
