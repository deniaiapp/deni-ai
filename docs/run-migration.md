# Runbook: moving Deni Run (run.deniai.app) into Deni AI (P6)

Deni Run used to be a separate app (deni-ai-computer) with its own sign-in and a
Cloudflare D1 database. On the platform it is Run mode (`/run/*`) in the web app,
its data lives in the `run_*` tables of the shared Postgres database, and its jobs
run in `services/run-worker`. This runbook moves the production data once and
retires the standalone app.

Tooling: `pnpm --filter @deniai/run migrate:d1` (`packages/run/scripts/migrate-from-d1.ts`,
library in `packages/run/src/migration/`). It was rehearsed against a local copy of
Run's SQLite database (phase P5); see "Rehearsal" below.

## What moves and what does not

| Deni Run (D1)                                  | Platform                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user` + `account` (provider `deni-ai`)        | Mapping only: a Run user moves to the Deni AI user in `account.account_id`. Unlinked users are reported and **not** migrated.                                          |
| `user_stores.data` (one JSON document)         | `run_settings`, `run_teammates`, `run_teammate_memories`, `run_threads`, `run_thread_participants`, `run_skills`, `run_routines`                                       |
| `thread_messages` (array per thread)           | `run_messages`, one row per message, in order                                                                                                                           |
| `agent_jobs` + `job_events`                    | `run_jobs` + `run_job_events`: **finished jobs only** (completed, failed, cancelled). Queued, running, waiting and uncertain jobs are reported and skipped.             |
| `job_artifacts`                                | `run_artifacts`; `object_key` keeps the existing S3/R2 key (`users/<sha256(old Run user id)>/workspace/<path>`); `run_settings.storage_key` keeps the old prefix       |
| `browser_workspaces`                           | `run_browser_workspaces` (for migrated jobs)                                                                                                                            |
| `mcp_connections` + `mcp_explanations`         | `run_mcp_connections` (secrets re-encrypted from `APP_ENCRYPTION_KEY` to the Run key) + `run_mcp_explanations`                                                         |
| `app_notifications`                            | `run_notifications`                                                                                                                                                     |
| `discord_links` + `discord_link_codes`         | `run_discord_links` + unexpired `run_discord_link_codes`                                                                                                                |
| `rate_limits`, sessions, 2FA, passkeys         | Not migrated (Deni AI accounts sign in with their own credentials; there is no Run-specific 2FA requirement any more)                                                   |
| Legacy `billing` / `usage` fields of the store | Ignored (usage has been billed by Deni AI since the integration; Run now charges the shared pool through the usage engine directly)                                    |

Workspace files and screenshots are **not copied**: they stay in the same bucket
under the same keys. Point the platform's `RUN_S3_*` variables at Run's bucket.

The Run key is `RUN_ENCRYPTION_KEY` (32 bytes, base64) or, when unset, a key derived
from `BETTER_AUTH_SECRET`. Set it explicitly in production before migrating; changing
it later makes stored MCP credentials unreadable.

## Before the day

1. Deploy the web app, the run worker and migration `0076` (the `run_*` tables) to
   production with Run mode enabled, but keep the Run home link pointing to
   run.deniai.app.
2. Configure the platform: `RUN_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `EXA_API_KEY`,
   `E2B_API_KEY`, `STEEL_API_KEY`, `RUN_S3_*` (Run's bucket), `SLACK_MCP_CLIENT_ID` /
   `SLACK_MCP_CLIENT_SECRET` (add `<web origin>/api/run/mcp/oauth/callback` as a Slack
   redirect URL), and on exactly one process `RUN_DISCORD_ENABLED=true` with
   `DISCORD_BOT_TOKEN` (the same bot): the run worker, or the web app when it runs
   Run in-process (`RUN_SCHEDULER_IN_PROCESS=true`, one instance).
3. **Link deadline.** Announce in Run (banner + email) that every account must be
   linked to a Deni AI account by a date (for example two weeks ahead); unlinked
   accounts are not migrated. Track progress with a dry run against a fresh D1
   export: the report lists unlinked users.
4. Rehearse on staging with a fresh export (`--dry-run`, then a real run, then
   `--verify`), and time it.

## On the day

1. **Read-only period.** Put run.deniai.app in maintenance (read-only) mode: stop
   accepting chat and new jobs, keep pages readable. Announce the window.
2. **Stop jobs.** Stop Run's scheduler/worker (`DENI_SCHEDULER=false`, scale the worker
   to 0) and the Discord bot. Wait until no job is `queued`, `running`, `finalizing`
   or `waiting_*`, or accept that those are skipped: the migration reports them by
   id and status. Users can re-send those tasks on the platform.
3. **Export D1.** `wrangler d1 export deni-run --remote --output run-export.sql
   --config services/d1-proxy/wrangler.jsonc` (from the old repository), and keep
   the old `APP_ENCRYPTION_KEY` available in a local env file (never commit it).
4. **Dry run** against production (the target guard refuses non-local hosts without
   the flag):

   ```bash
   cd packages/run
   pnpm exec tsx --env-file=<platform env file> scripts/migrate-from-d1.ts \
     --source run-export.sql --target-url "$DATABASE_URL" \
     --source-key-env-file <file with the old APP_ENCRYPTION_KEY> \
     --dry-run --report dry-run.json --i-know-this-is-production
   ```

   Review: unlinked users, links to Deni AI users that do not exist, skipped jobs,
   messages of deleted conversations. Do not use the rehearsal options
   (`--create-placeholder-users`, `--rehearsal-link-unlinked`, `--map`); they are
   refused for non-local hosts.
5. **Migrate**: the same command without `--dry-run` (`--report run.json`). Each user
   is migrated in its own transaction; re-running is safe (rows already present are
   skipped, a second run reports 0 new rows).
6. **Verify**: the same command with `--verify` (exit code 0 means counts match per
   user and table and spot checks pass: message content, teammate instructions, job
   status, artifact object keys, storage key, MCP secrets decrypting with the new key).
7. **Redirect run.deniai.app** to `<web origin>/run` (301 for every path; keep
   `/api/*` answering 410 so old clients fail clearly). Point the Run home link and
   `NEXT_PUBLIC_DENI_RUN_URL` users at Run mode. Turn on the platform worker's
   scheduler and Discord.
8. Post a notice that Run moved; Discord links keep working because the bot and the
   link rows moved.

## After

1. Keep D1 read-only for a fixed period (for example 30 days) for support lookups
   and a possible re-run for a late-linking user (`--source` the same export; only
   their rows are new).
2. Remove the standalone integration from the web app:
   `/api/integrations/deni-run/usage`, `DENI_RUN_SERVICE_SECRET`,
   `DENI_RUN_OAUTH_CLIENT_ID` and the Deni Run OAuth client.
3. **Shut down D1**: delete the d1-proxy Worker and the D1 database, revoke
   `D1_PROXY_TOKEN`, Run's Google/GitHub OAuth clients and its Resend sender, and
   archive the deni-ai-computer repository.

## Rollback

Before step 7 nothing user-visible has changed: delete the migrated users' `run_*`
rows (`DELETE FROM run_settings ...` is not enough — delete from each `run_*` table
for those user ids, or restore the pre-migration backup) and lift maintenance mode on
run.deniai.app. After step 7, revert the redirect; data written on the platform since
then stays there.

## Rehearsal (P5, local)

Source: deni-ai-computer `.deni/local.sqlite` (2 Run users, neither linked to Deni
AI), target: the trial database. Options used: `--rehearsal-link-unlinked
--create-placeholder-users` (localhost only). First run: 2 settings, 6 teammates,
6 threads (6 participants), 2 skills, 61 messages, 30 jobs (27 completed, 3 failed;
none skipped), 65 job events, 2 artifacts, 30 browser workspaces, 4 MCP connections
(3 OAuth states re-encrypted), 2 MCP explanations, 40 notifications, 1 Discord link;
2 messages of a deleted conversation skipped; not migrated: 16 rate limits, 3 sessions,
2 verifications, 1 2FA row, 1 auth rate limit. Second run: 0 new rows. `--verify`: OK.
