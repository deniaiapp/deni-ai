# Deni AI v8 takeover of deniai.app

How v8 (this monorepo, `apps/web`) replaces v7 (the `deni-ai` repository) at
`deniai.app` after the private beta (`docs/v8-beta-rollout.md`). Both apps already
share the production Postgres database, the R2 bucket and `BETTER_AUTH_SECRET`, so
the takeover moves **traffic and background work**, not data.

After the takeover:

- `deniai.app` serves v8, which runs the scheduled jobs and the Stripe webhook.
- `beta.deniai.app` redirects to `deniai.app`.
- v7 is stopped but kept deployable (image, env) for the rollback window.

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
| Run mode (`/run`)           | Opens to everyone. Needs `services/run-worker` (or `RUN_SCHEDULER_IN_PROCESS=true` on a single instance), or set `RUN_ENABLED=false` to keep it off until the worker is ready. The D1 import is a separate step (`docs/run-migration.md`).                                            |
| Beta-only UI                | The sidebar "Beta" label and the account menu's "Send feedback" (beta form) and "Go to Deni AI v7" items follow `BETA_ACCESS_REQUIRED` (`platformCapabilities.privateBeta`), so they disappear with the gate. `/private-beta` stays as a route but nothing sends users there.          |
| Retired pages               | guides, use cases, about and models answer 301 (`apps/web/vite/route-rules.ts`). Canonical URLs already use `https://deniai.app`.                                                                                                                                                   |
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
3. **Build v8 for `deniai.app`**: `docker build -f apps/web/Dockerfile --build-arg
   NEXT_PUBLIC_BETTER_AUTH_URL=https://deniai.app ...` (the other `NEXT_PUBLIC_*`
   build arguments as for v7).
4. **Configure v8** with v7's production values except:

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
   | `RUN_SCHEDULER_IN_PROCESS`, `RUN_ENABLED`             | Unset with a run worker; otherwise see "Run mode" above                   |
   | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `R2_*`          | Unchanged (already v7's)                                                  |

5. **Switch traffic**: point `deniai.app` at the v8 deployment, and make
   `beta.deniai.app` answer `301` to the same path on `deniai.app`.
6. **Stop v7** (or set `DISABLE_BACKGROUND_JOBS=1` on it if it must keep running) so
   only v8 runs the jobs. Keep its image and env.
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

1. Point `deniai.app` back at v7 and remove `DISABLE_BACKGROUND_JOBS` from it.
2. Stop v8, or put it back on `beta.deniai.app` with the beta env
   (`BETA_ACCESS_REQUIRED=true`, `CRON_ENABLED=false`, `STRIPE_WEBHOOK_ENABLED=false`,
   `NOINDEX=1`, the beta GitHub OAuth App, `NEXT_PUBLIC_BETTER_AUTH_URL` rebuilt for
   beta).

What v7 cannot show: Run mode data, per-account preferred models and the per-chat
model (`0081`). Accounts that turned on two-factor authentication on v8 keep it on v7.

## After the takeover

- Retire the beta deployment and the beta GitHub OAuth App once the redirect has
  served for a while.
- The rules in `docs/v8-beta-rollout.md` ("Rules during the beta") end with the
  rollback window: until then keep schema changes additive so v7 can still take
  traffic back.
- v7's repository stops receiving feature work; model updates land here only.
