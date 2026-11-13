# @deniai/run-worker

The Deni Run worker: a Node process that runs Run mode's background work outside the web
app. It is the platform successor of the standalone Deni Run's `pnpm worker`.

With a single web instance, the web app can run the same work itself instead
(`RUN_SCHEDULER_IN_PROCESS=true`, plus `RUN_DISCORD_ENABLED=true` for the bot; see
`apps/web/AGENTS.md`), which saves this process (about 90 MB at rest). Run this worker
when the web app has more than one instance, or to keep jobs apart from web requests.
Never run both for the Discord bot.

- **Scheduler** (`@deniai/run/jobs/scheduler`): every tick it marks jobs whose lease
  expired as `uncertain` (they may have had external side effects, so they wait for a
  reviewed retry), enqueues due routines, and claims queued jobs up to
  `RUN_SCHEDULER_CONCURRENCY` with `FOR UPDATE SKIP LOCKED`. A claimed job holds a lease
  that heartbeats and checkpoints renew.
- **Discord bot** (`@deniai/run/discord/*`, only with `RUN_DISCORD_ENABLED=true` and
  `DISCORD_BOT_TOKEN`): teammates in Discord direct messages, slash commands, Approve /
  Deny buttons for gated actions, and DMs for background results (routines, retries,
  handoffs) while the person's `/notify` is on.

Usage is charged through the shared usage engine (`@deniai/billing/server`) directly;
nothing is reported over HTTP.

## Environment

| Variable                                                      | Meaning                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (or `DENI_DATABASE_URL`)                       | The Deni AI Postgres database (pooled URL is fine; `prepare: false`).                                                                       |
| `BETTER_AUTH_URL`                                             | Public origin of the web app; links in Discord replies point to `<origin>/run`.                                                             |
| `RUN_ENCRYPTION_KEY`                                          | 32 bytes, base64: the key of Run secrets (MCP credentials). Unset: derived from `BETTER_AUTH_SECRET` (set the same as the web).             |
| `OPENROUTER_API_KEY`, `EXA_API_KEY`                           | Model calls and the `webSearch` tool.                                                                                                       |
| `E2B_API_KEY`, `STEEL_API_KEY` (+ `STEEL_BASE_URL`, timeouts) | Computer providers (terminal sandbox, cloud browser). Unset: the computer is off.                                                           |
| `RUN_S3_*`                                                    | Workspace and screenshot storage (`RUN_S3_ENDPOINT`, `RUN_S3_REGION`, `RUN_S3_ACCESS_KEY_ID`, `RUN_S3_SECRET_ACCESS_KEY`, `RUN_S3_BUCKET`). |
| `RUN_BROWSER_USD_PER_HOUR`, `RUN_COMPUTER_USD_PER_HOUR`       | Provider cost of browser and computer time (defaults 0.10 and 0.15).                                                                        |
| `RUN_SCHEDULER_CONCURRENCY`                                   | Jobs this process runs at once (default 4, max 16).                                                                                         |
| `RUN_SCHEDULER_ENABLED`                                       | `false` runs only the Discord bot (default `true`).                                                                                         |
| `RUN_DISCORD_ENABLED`, `DISCORD_BOT_TOKEN`                    | Both are required to start the bot.                                                                                                         |
| `DISCORD_INVITE_URL`                                          | Install link of the bot (shown by the web app's Discord card).                                                                              |
| `RUN_SHUTDOWN_TIMEOUT_MS`                                     | How long SIGTERM waits for running jobs (default 60000).                                                                                    |

The full list of Run variables is read by `loadRunConfig()` in
`packages/run/src/runtime.ts`.

## Local development

```bash
cp ../../apps/web/.env.local .env   # or write a .env with the variables above
pnpm --filter @deniai/run-worker dev
```

Without a separate process, the web app can run the scheduler in-process with
`RUN_SCHEDULER_IN_PROCESS=true` in `apps/web/.env.local` (see above for production).

`pnpm --filter @deniai/run-worker test` runs the tests on PGlite with the model, tools and
computer mocked; nothing connects to Discord, OpenRouter, E2B or Steel.

## Docker

```bash
docker build -f services/run-worker/Dockerfile -t deni-run-worker .
```

The image runs one esbuild bundle (`dist/worker.mjs`). `playwright-core` (used to drive
Steel's browser over CDP) is kept outside the bundle because it reads its own files at
runtime, and is copied next to the bundle; no browser is installed. Discord's optional
native modules (`zlib-sync`, `bufferutil`, `utf-8-validate`) are not installed.

## Scaling

Several workers can run the scheduler at once: claims use `FOR UPDATE SKIP LOCKED` and
leases, so a job runs on one worker, and a worker that dies leaves its job to the lease
recovery. The Discord bot must run on **exactly one** instance (one gateway connection;
its rate limits are in memory): set `RUN_DISCORD_ENABLED=true` on one worker, or on the
web app with the in-process scheduler, never on both.

SIGINT/SIGTERM stop claiming, wait up to `RUN_SHUTDOWN_TIMEOUT_MS` (default 60 s) for
running jobs, disconnect Discord and end the database pool. minidock stops an old
container with a 10 s grace period, so on minidock set it below 10000.

## Discord link codes

The code a person sends the bot is created by the web app (Run settings). The format
is defined in `src/discord/link-code.ts` (8 characters without 0/O/1/I/L, shown as
`ABCD-EFGH`, stored as the SHA-256 of the normalized code in
`run_discord_link_codes.code_hash`, valid for 10 minutes, one active code per user).
