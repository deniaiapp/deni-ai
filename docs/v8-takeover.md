# Deni AI v8 takeover of deniai.app

How v8 (this monorepo, `apps/web`) replaces v7 (the `deni-ai` repository) at
`deniai.app`. Usually this is the last step of the percentage rollout
(`docs/v8-rollout.md`), once v8 serves everyone without trouble; it also works
straight after the private beta (`docs/v8-beta-rollout.md`). Both apps already
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
| Deni AI as OAuth provider   | Standalone Deni Run (run.deniai.app) keeps `deniai.app` as issuer and redirect target. The OAuth clients, consents and JWKS are rows in the shared database, so they keep working; v8 needs `DENI_RUN_OAUTH_CLIENT_ID` and `DENI_RUN_SERVICE_SECRET` with v7's values.                 |
| Flixa                       | Unchanged: the production API stays on the old flixa-backend. `services/agent-api` stays undeployed (or `FLIXA_USAGE_ENGINE=shadow`).                                                                                                                                               |
| Run mode (`/run`)           | The beta runs with `RUN_ENABLED=false`. Turning it on opens Run to everyone and needs `services/run-worker` (or `RUN_SCHEDULER_IN_PROCESS=true` on a single instance); keep it off until the worker is ready. The D1 import is a separate step (`docs/run-migration.md`).          |
| Beta-only UI                | The sidebar "Beta" label and the account menu's "Send feedback" (beta form) and "Go to Deni AI v7" items follow `BETA_ACCESS_REQUIRED` (`platformCapabilities.privateBeta`), so they disappear with the gate. `/private-beta` stays as a route but nothing sends users there.          |
| Retired pages               | guides, use cases, about and models answer 308 permanent redirects (`apps/web/vite/route-rules.ts`). Canonical URLs already use `https://deniai.app`.                                                                                                                                                   |
| Google sign-in, Turnstile   | No change: `deniai.app` is already registered.                                                                                                                                                                                                                                      |
| GitHub sign-in              | Switch back to v7's GitHub OAuth App (callback on `deniai.app`). Accounts are matched by GitHub user id, so links made on beta keep working.                                                                                                                                        |

## Before the day

1. **Code for the release** (lands on `canary`, promoted to `master`):
   - Choose the 8.0 codename and release date in `apps/web/src/lib/version.ts`
     (`appCodename` is still the `Private Beta` placeholder, `appDate` the beta date).
   - Rewrite the 8.0 entry in `apps/web/src/lib/changelog.ts` (English and `ja`) as a
     release instead of a private beta ("Run starts empty here" too, if the D1 import
     has run by then).
   - Finish or leave out unfinished work; release from a clean, verified `canary`.
2. **Beta health**: no open Sentry issue on v8 that v7 does not have; testers' usage
   pool and Max Mode numbers agree between v7 and v8; no `run_jobs` stuck in
   `running`.
3. **Run worker**: deploy `services/run-worker` against the production database with
   the Run env (`services/run-worker/README.md`), or decide on `RUN_ENABLED=false`.
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
3. **Save v7's configuration**: copy the `deni-ai` app's Environment, Build-time
   Arguments, branch and Dockerfile path somewhere safe. A minidock rollback starts
   the old image with the **current** Environment, so going back to v7 needs them.
4. **Switch the `deni-ai` app to v8** in the minidock panel: branch `beta/v8` (or
   `master` once v8 is promoted there), Dockerfile `apps/web/Dockerfile`, the
   Build-time Arguments of `deni-ai-beta` with
   `NEXT_PUBLIC_BETTER_AUTH_URL=https://deniai.app` (and the other `NEXT_PUBLIC_*`
   values as for v7), and v7's production Environment except:

   | Variable                                              | Value at takeover                                                         |
   | ----------------------------------------------------- | ------------------------------------------------------------------------- |
   | `BETTER_AUTH_URL`                                     | `https://deniai.app`                                                      |
   | `BETA_ACCESS_REQUIRED`, `BETA_ACCESS_PAID_PLANS`      | Unset                                                                     |
   | `CRON_ENABLED`, `STRIPE_WEBHOOK_ENABLED`              | Unset (default `true`)                                                    |
   | `STRIPE_WEBHOOK_SECRET`                               | v7's value                                                                |
   | `NOINDEX`                                             | Unset                                                                     |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`            | v7's GitHub OAuth App                                                     |
   | `DENI_RUN_OAUTH_CLIENT_ID`, `DENI_RUN_SERVICE_SECRET` | v7's values                                                               |
   | `PASSKEY_RP_ID`                                       | `deniai.app` or unset (the auth URL's host)                               |
   | `RUN_SCHEDULER_IN_PROCESS`, `RUN_ENABLED`             | `RUN_ENABLED=false` until a run worker runs; see "Run mode" above        |
   | `ROLLOUT_SWITCH_ENABLED`                              | Unset (no Worker after the takeover)                                      |
   | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `R2_*`          | Unchanged (already v7's)                                                  |

   Then press **Deploy**. Once the health check passes, `deniai.app` serves v8 and the
   v7 container is gone, so only v8 runs the jobs and receives the webhook.
5. **Remove the rollout Worker** if it runs: set `V8_PERCENT=0` (everything then
   reaches the `deni-ai` app, now v8), then delete the Worker's `deniai.app/*` route.
   Visitors' `deni_variant` cookies are ignored from then on.
6. **Retire the beta host**: stop the `deni-ai-beta` app and add a Cloudflare
   redirect rule from `beta.deniai.app/*` to the same path on `deniai.app` (Caddy
   cannot redirect).
7. **Smoke test** on `deniai.app`:
   - An existing v7 session is still signed in; email, Google, GitHub and passkey
     sign-in work; a guest can start a chat.
   - A chat streams and its usage appears in Settings → Billing.
   - Stripe: send a test webhook from the dashboard (or watch the next real event)
     and check it answers 2xx from v8.
   - Logs show the in-process jobs starting (`usage-and-meter`, `storage-cleanup`,
     `guest-cleanup`, `model-health`); `/api/status/models` returns results.
   - run.deniai.app sign-in with Deni AI and its usage reporting
     (`/api/integrations/deni-run/usage`) work; Flixa sign-in works.
   - `/run` creates a job and the worker picks it up (unless Run is off).
   - The sidebar has no "Beta" label and the account menu no "Go to Deni AI v7".
8. **Watch** for the first days: Sentry, Stripe webhook delivery failures, the
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
   (`BETA_ACCESS_REQUIRED=true`, `CRON_ENABLED=false`, `STRIPE_WEBHOOK_ENABLED=false`,
   `NOINDEX=1`, the beta GitHub OAuth App, `NEXT_PUBLIC_BETTER_AUTH_URL` rebuilt for
   beta) and remove the beta redirect rule.

What v7 cannot show: Run mode data, per-account preferred models and the per-chat
model (`0081`). Accounts that turned on two-factor authentication on v8 keep it on v7.

## After the takeover

- Retire the beta deployment and the beta GitHub OAuth App once the redirect has
  served for a while.
- The rules in `docs/v8-beta-rollout.md` ("Rules during the beta") end with the
  rollback window: until then keep schema changes additive so v7 can still take
  traffic back.
- v7's repository stops receiving feature work; model updates land here only.
