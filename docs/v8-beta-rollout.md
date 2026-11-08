# Deni AI v8 private beta rollout

v8 (this monorepo, `apps/web`) ships as a **private beta on its own domain**
(`beta.deniai.app` below) while v7 (the `deni-ai` repository) keeps serving
`deniai.app`. Both use the **same production Postgres database**. Only invited
accounts may use v8. What stays as it is during the beta:

- v7 at deniai.app: no deploy is needed for the beta. It keeps running the
  scheduled jobs and processing Stripe webhooks.
- Deni AI Ads: campaigns, Stripe checkout and delivery are unchanged, and ads
  render in v8 in the same places (chat start screen, below answers, public home).
- Flixa: the production API stays on the old flixa-backend. v8's
  `services/agent-api` is not deployed, or only with `FLIXA_USAGE_ENGINE=shadow`.
- Deni Run: the standalone run.deniai.app keeps running against v7 (its OAuth
  provider and `/api/integrations/deni-run/usage`). Run mode in v8 (`/run`) starts
  empty: its `run_*` tables are new, and the D1 import (`docs/run-migration.md`)
  is not part of this rollout.

## How the gate works

`BETA_ACCESS_REQUIRED=true` turns it on (default off).

- Who has access: verified admins (`ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS`, same rule
  as reset-credit grants), or an account with a `beta_access` row. Admins add rows by
  email in **Settings → Beta testers**, before or after the person signs up; the row
  is linked to the account (`user_id`) the first time a signed-in user with that
  **verified** email is checked, and then follows the account. Guests never have access.
- Pages: the `/_app` route guard sends everyone else to `/private-beta`, which shows the
  account they are signed in with, **Go to Deni AI (v7)** (`NEXT_PUBLIC_V7_URL`) and
  sign-out.
- Server: the `betaAccessGate` request middleware (`apps/web/src/start.ts`) runs before
  every route handler. A signed-in user without access gets
  `403 {"code":"beta_access_required"}` from every `/api/*` route (tRPC, chat, Run,
  attachments, uploads, ad campaigns, device auth, any new endpoint) except
  `/api/auth/*`, `/api/stripe/*`, `/api/cron/*`, `/api/status/*`, `/api/integrations/*`
  and ad delivery (`/api/ads`, `/api/ads/view`, `/api/ads/click`), and `/new/*`
  redirects to `/private-beta`. Guest sign-in (`POST /api/auth/sign-in/anonymous`) is
  refused and the guest button is hidden. Public pages, legal pages and `/api/status`
  stay open.
- A grant is cached for one minute per server process; refusals are not cached, so a
  new grant applies on the next request and a removal within a minute.

## Coexistence findings

| Area                                | What runs where during the beta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage recovery (`usage-and-meter`)  | Concurrency-safe (per-user lock, settled reservations skipped), but **v7 only**: it settles every stale reservation in the shared table, including the old flixa-backend's, which `0075` defaults to `product = 'chat'`. v8 sets `CRON_ENABLED=false`.                                                                                                                                                                                                                                                                                                  |
| Storage cleanup (`storage-cleanup`) | Row-level safe, but **v7 only**: it deletes objects through the deployment's own R2 settings, so a v8 pointed at another bucket would delete rows whose files it cannot see. v8 must still use the **same R2 bucket** as v7 (attachment rows hold the object keys).                                                                                                                                                                                                                                                                                     |
| Guest cleanup (`guest-cleanup`)     | Idempotent (deleting twice changes nothing), but **v7 only**: v8 refuses guests, so it has none of its own. Deleting a user cascades the new `run_*` and `chat_messages` rows in the database.                                                                                                                                                                                                                                                                                                                                                          |
| Model health (`model-health`)       | Per-process, in memory, no database: safe on both. v8's in-process probes keep running with `CRON_ENABLED=false` (they spend a few provider tokens every 5 minutes; `DISABLE_BACKGROUND_JOBS=1` would stop them and leave the model picker's status empty).                                                                                                                                                                                                                                                                                             |
| `CRON_ENABLED=false` (v8)           | `/api/cron/*` answer `200 {"skipped":true,"reason":"cron_disabled"}`; the in-process usage, storage and guest jobs do not start. No external scheduler should call v8.                                                                                                                                                                                                                                                                                                                                                                                  |
| Run scheduler / worker              | **v8 only** (v7 has no Run). Routines, stale leases and job claiming need `services/run-worker` deployed with the same `DATABASE_URL`, `RUN_ENCRYPTION_KEY` (or the same `BETTER_AUTH_SECRET`) and Run env, or, for a single small instance only, `RUN_SCHEDULER_IN_PROCESS=true` on the v8 web server (never on more than one process). The Discord bot only with `RUN_DISCORD_ENABLED=true` on one worker.                                                                                                                                            |
| Stripe webhooks                     | **v7 only.** Stripe keeps pointing at `https://deniai.app/api/stripe/webhook`; do not add a v8 endpoint. v8 sets `STRIPE_WEBHOOK_ENABLED=false` (503 without reading the event) and needs no `STRIPE_WEBHOOK_SECRET`. v8 still needs `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for checkout and the portal; their success and return URLs use the beta origin, and v7's webhook updates the shared rows. Apple Pay / Google Pay in Stripe Elements: register `beta.deniai.app` as a payment method domain if they should appear there. |
| Passkeys                            | The rpID defaulted to the auth URL's host, so existing passkeys are bound to `deniai.app`. `PASSKEY_RP_ID=deniai.app` on v8 lets them work on `beta.deniai.app` (a registrable suffix of the page host); the origin is still checked per request (the browser's `Origin`). Passkeys created on v8 then also work on v7.                                                                                                                                                                                                                                 |
| Sessions and cookies                | Better Auth cookies are host-only (no cross-subdomain cookie), so v7 and v8 sessions are separate: users sign in once on beta. Sessions are rows in the shared `session` table either way. `BETTER_AUTH_SECRET` **must equal v7's**: TOTP secrets and backup codes are encrypted with it, and Run derives its key from it when `RUN_ENCRYPTION_KEY` is unset.                                                                                                                                                                                           |
| Auth URL                            | `BETTER_AUTH_URL` and `NEXT_PUBLIC_BETTER_AUTH_URL` = `https://beta.deniai.app`. The public one is inlined at build time: pass it as the Docker build argument. Email links (verification, magic link, password reset, invitations) then point at beta.                                                                                                                                                                                                                                                                                                 |
| Google sign-in                      | Add `https://beta.deniai.app/api/auth/callback/google` to the OAuth client's authorized redirect URIs (and `https://beta.deniai.app` to the JavaScript origins). The same client id and secret work.                                                                                                                                                                                                                                                                                                                                                    |
| GitHub sign-in                      | A GitHub OAuth App has one callback URL on one host, so create a second OAuth App for `https://beta.deniai.app/api/auth/callback/github` and give v8 its id and secret. Existing links keep working: accounts are matched by GitHub user id.                                                                                                                                                                                                                                                                                                            |
| Deni AI as OAuth provider           | Consumers (standalone Deni Run) keep `deniai.app` as issuer and redirect target. Do not register them against beta; `DENI_RUN_OAUTH_CLIENT_ID` and `DENI_RUN_SERVICE_SECRET` can stay unset on v8 (the integration route then answers 503).                                                                                                                                                                                                                                                                                                             |
| Turnstile                           | Add `beta.deniai.app` to the widget's hostnames, or leave both Turnstile keys unset on v8 (sign-up and sign-in then run without CAPTCHA; guests are refused anyway).                                                                                                                                                                                                                                                                                                                                                                                    |
| CSP, canonical URLs, crawlers       | The CSP is `'self'`-based, so nothing changes. Canonical and Open Graph URLs stay `https://deniai.app`; set `NOINDEX=1` on v8 so the beta is not indexed.                                                                                                                                                                                                                                                                                                                                                                                               |
| Client IP, ads billing              | Same edge setup as v7 (`CLIENT_IP_HEADER=cf-connecting-ip` behind Cloudflare). Ad click tokens are checked against v8's own origin, which works because the beta serves its own cards. AdSense (if used) covers subdomains of the approved site.                                                                                                                                                                                                                                                                                                        |
| Chat transcripts                    | v8 writes `chats.messages` and `chat_messages` and sets `message_count`; v7 only writes the jsonb. Migration `0079` adds a trigger that resets `message_count` to NULL when an update changes `messages` without setting `message_count`, so v8 falls back to the jsonb for chats v7 changed (no v7 deploy needed).                                                                                                                                                                                                                                     |

## Rollout order

1. **Back up the production database.** Create a Neon branch (or `pg_dump -Fc`) and note
   its name and time; confirm it can be restored before going on.
2. **Apply migrations `0075`–`0079` from this repository** to production. Both
   repositories share migrations `0000`–`0074` (same tags and timestamps), so drizzle
   applies only the new ones. Check first that the last applied migration is `0074`:

   ```sql
   select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 3;
   -- the newest created_at should be 1794031129714 (0074_cancellation_feedback)
   ```

   Then, from the root, with `apps/web/.env` holding the production `DATABASE_URL`:

   ```bash
   pnpm --filter @deniai/db db:migrate
   ```

   All five are additive: `0075` adds `usage_reservation.product` (default `'chat'`),
   `0076` the `chat_messages` table and the nullable `chats.message_count`, `0077` the
   `run_*` tables, `0078` `beta_access`, and `0079` the `chats` trigger that keeps v7's
   writes visible to v8. v7 keeps working without changes. Do not run
   `db:migrate:flixa` for this rollout.

3. **Deploy v8 to `beta.deniai.app`** (`docker build -f apps/web/Dockerfile --build-arg
   NEXT_PUBLIC_BETTER_AUTH_URL=https://beta.deniai.app .`) with the production values of
   v7 except:

   | Variable                                                                                                                                               | Value on v8                                                                                                                          |
   | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
   | `BETA_ACCESS_REQUIRED`                                                                                                                                 | `true`                                                                                                                               |
   | `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` (build arg)                                                                                           | `https://beta.deniai.app`                                                                                                            |
   | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `R2_*`                                                                                                           | **Same as v7**                                                                                                                       |
   | `CRON_ENABLED`                                                                                                                                         | `false` (no job is v8-only; Run's scheduler runs in the worker)                                                                      |
   | `STRIPE_WEBHOOK_ENABLED`                                                                                                                               | `false`; leave `STRIPE_WEBHOOK_SECRET` unset                                                                                         |
   | `PASSKEY_RP_ID`                                                                                                                                        | `deniai.app`                                                                                                                         |
   | `NEXT_PUBLIC_V7_URL`                                                                                                                                   | `https://deniai.app` (the default; build time)                                                                                       |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                                                                             | The beta OAuth App                                                                                                                   |
   | `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS`                                                                                                                 | The operators who manage testers                                                                                                     |
   | `NOINDEX`                                                                                                                                              | `1`                                                                                                                                  |
   | `DENI_RUN_SERVICE_SECRET`, `DENI_RUN_OAUTH_CLIENT_ID`                                                                                                  | Unset (standalone Run stays on v7)                                                                                                   |
   | Run: `OPENROUTER_API_KEY`, `EXA_API_KEY`, `E2B_API_KEY`, `STEEL_*`, `RUN_S3_*`, `RUN_ENCRYPTION_KEY`, `RUN_*_USD_PER_HOUR`, `SLACK_MCP_*`, `DISCORD_*` | As needed; missing providers show a disabled state                                                                                   |
   | `RUN_SCHEDULER_IN_PROCESS`                                                                                                                             | Unset when `services/run-worker` is deployed (same `DATABASE_URL` and Run env); `true` only on a single v8 instance without a worker |

   Flixa: keep `services/agent-api` undeployed, or deploy it only with
   `FLIXA_USAGE_ENGINE=shadow`. Then configure the domain items in the table above
   (Google redirect URI, GitHub OAuth App, Turnstile hostname, Stripe payment method
   domain if needed).

4. **Grant testers.** Sign in on beta with an admin account, open **Settings → Beta
   testers**, add each tester's email with a note. Check one tester end to end: they
   reach `/chat`, and an uninvited account sees `/private-beta`.
5. **Watch** for the first days:
   - Logs: `[beta-access]` grants and removals; 403 `beta_access_required` counts (a spike
     means an invited tester is refused, e.g. an unverified email).
   - Sentry on both deployments; v7's background job warnings (the jobs still run there).
   - Chats edited in both apps: messages written in v7 appear in v8 (trigger `0079`).
   - Usage pool and Max Mode numbers agree between v7 and v8 for a tester.
   - Run: worker logs, `run_jobs` stuck in `running`, E2B / Steel spend.

## Rollback

- **Turn the beta off**: remove the `beta.deniai.app` route or stop the v8 deployment.
  v7 keeps working unchanged: every migration is additive and the `0079` trigger only
  clears a column v7 does not read.
- To close it to testers without taking it down, remove them in Settings → Beta
  testers (or empty `beta_access`); admins still get in.
- **Abandoning v8 later** (after a backup): drop the new objects. The 0079 trigger and function are
  defined in `packages/db/migrations/0079_chats_message_count_trigger.sql`.

  ```sql
  DROP TRIGGER IF EXISTS "chats_reset_message_count" ON chats;
  DROP FUNCTION IF EXISTS "chats_reset_message_count_for_unsynced_writes"();
  DROP TABLE beta_access;
  DROP TABLE run_artifacts, run_browser_workspaces, run_discord_link_codes, run_discord_links,
    run_job_events, run_jobs, run_mcp_connections, run_mcp_explanations, run_messages,
    run_notifications, run_routines, run_settings, run_skills, run_teammate_memories,
    run_teammates, run_thread_participants, run_threads;
  DROP TABLE chat_messages;
  ALTER TABLE chats DROP COLUMN message_count;
  ALTER TABLE usage_reservation DROP COLUMN product;
  DELETE FROM drizzle.__drizzle_migrations WHERE created_at > 1794031129714; -- after 0074
  ```

  Run's objects in `RUN_S3_*` and any E2B / Steel resources are not removed by this.

## Rules during the beta

- Schema changes are made **only in `packages/db` of this repository**, stay additive
  (v7 must keep working against them), and are applied with this repository's
  migrations. v7 must not generate or apply migrations.
- v7 keeps the scheduled jobs and the Stripe webhook; v8 keeps `CRON_ENABLED=false` and
  `STRIPE_WEBHOOK_ENABLED=false` until it takes over deniai.app.
- Deni AI Ads placements stay as they are in both apps.
- The codename of 8.0 is a placeholder (`appCodename` in `apps/web/src/lib/version.ts`).
