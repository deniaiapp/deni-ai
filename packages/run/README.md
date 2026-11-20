# @deniai/run

Deni Run on the Deni AI platform: AI teammates, DM and group threads, the agent
runtime, the Postgres job queue, the account computer (E2B sandbox, Steel browser),
MCP connectors with approval gates, skills, routines and notifications. Server-only;
consumed as TypeScript source by `apps/web` (Run mode, `/run/*`) and
`services/run-worker` (scheduler and Discord bot), or by the web app alone with
`RUN_SCHEDULER_IN_PROCESS=true`. The Discord bot is `src/discord` (`@deniai/run/discord/bot`,
`@deniai/run/discord/push`).

The code was moved here from the standalone Deni Run (`deni-ai-computer`,
`src/lib/*`) with `git mv`, so `git log --follow` reaches its history.

## Wiring a host

Packages never import an app. A host calls `configureRun()` once before using any
module:

```ts
import { configureRun, loadRunConfig, runUsageBinding } from "@deniai/run";

configureRun({
  db, // any Drizzle Postgres database over the shared schema (@deniai/db)
  usage: runUsageBinding(usageEngine), // createUsageEngine() from @deniai/billing/server
  config: loadRunConfig(process.env),
  logger: console,
  onNotification: (notification) => pushToDiscord(notification), // optional
});
```

Optional `RunDeps` for tests: `computer: { sandbox, browser }` (inject fake providers,
`null` turns one off) and `languageModel: (modelId) => LanguageModel` (replaces
the Deni AI API). `@deniai/run/testing` creates a PGlite database with the real `public`
migrations plus the `run_*` tables, configures the runtime with the real usage engine,
and provides `mockTextModel()`.

## Environment (`loadRunConfig`)

| Variable                                                                                                                           | Meaning                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RUN_ENCRYPTION_KEY`                                                                                                               | 32 bytes, base64: AES-256-GCM key for MCP credentials and BYOK keys. Unset: derived from the next one |
| `BETTER_AUTH_SECRET`                                                                                                               | Platform secret the Run key is derived from (`sha256("deni-run:v1:" + secret)`)                       |
| `DENI_API_KEY`, `DENI_API_BASE_URL`                                                                                                | Deni AI API: the upstream of every model. Without the key, chat answers 503 `llm_unconfigured`        |
| `EXA_API_KEY`                                                                                                                      | Offers the `webSearch` tool                                                                           |
| `E2B_API_KEY`, `E2B_SANDBOX_TIMEOUT_MS`, `E2B_SANDBOX_IDLE_MS`                                                                     | Terminal (one paused/resumable sandbox per user). Unset: no `runCommand` tool                         |
| `STEEL_API_KEY`, `STEEL_BASE_URL`, `STEEL_SESSION_TIMEOUT_MS`, `STEEL_SESSION_IDLE_MS`                                             | Cloud browser (persistent profile per user). Unset: no `browser`/`requestTakeover` tools              |
| `RUN_S3_ENDPOINT`, `RUN_S3_REGION`, `RUN_S3_ACCESS_KEY_ID`, `RUN_S3_SECRET_ACCESS_KEY`, `RUN_S3_BUCKET`, `RUN_S3_FORCE_PATH_STYLE` | Workspace files and screenshots (S3/R2). Unset: the local data dir (refused in production)            |
| `RUN_LOCAL_DATA_DIR`                                                                                                               | Local workspace mirror and screenshots in development (default `.deni`)                               |
| `RUN_BROWSER_USD_PER_HOUR`, `RUN_COMPUTER_USD_PER_HOUR`                                                                            | Provider cost charged to the pool (defaults 0.10 and 0.15)                                            |
| `RUN_SCHEDULER_CONCURRENCY`                                                                                                        | Jobs one scheduler runs at once (default 4, max 16)                                                   |
| `SLACK_MCP_CLIENT_ID`, `SLACK_MCP_CLIENT_SECRET`                                                                                   | OAuth client of the Slack MCP connector                                                               |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL`                                                                                  | Public origin (links, MCP OAuth redirect `{origin}/api/run/mcp/oauth/callback`)                       |

`runCapabilities()` / `computerCapabilities()` say which providers are configured; the
computer state (`withBrowserLive`) carries `capabilities` so the UI can show a disabled
computer panel.

## Modules (`@deniai/run/<path>` resolves to `src/<path>.ts`)

| Path                                                                            | What it does                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`, `usage-binding`                                                      | `configureRun`, `loadRunConfig`, the `db` proxy, `runUsageBinding(engine)`                                                                                                                                                                                            |
| `data/store`                                                                    | `readStore`/`mutateStore` (the old per-user document API over the relational `run_*` tables, one transaction holding the `run_settings` row lock), `loadMessages`/`saveMessages` (one row per message), thread deletion                                               |
| `jobs`                                                                          | The queue: `createJob` (idempotent per user), `createClaimedJob`, `claimNextJobs` (`FOR UPDATE SKIP LOCKED`), `claimJob`, `heartbeatJob`, `checkpointJob`, `appendJobEvent`, `cancelJob`, `retryJob` (with backoff), `recoverStaleJobs` (expired lease → `uncertain`) |
| `jobs/scheduler`                                                                | `startScheduler({ intervalMs })` → stop function, `tick()`, `enqueueRoutine`, `waitForRunningJobs`                                                                                                                                                                    |
| `jobs/runner`                                                                   | `runBackgroundJob(userId, jobId)`, `runClaimedJob(job)`: heartbeat every 30 s, checkpoint per step, abort on cancellation                                                                                                                                             |
| `jobs/actions`, `jobs/notifications`, `jobs/routines`, `jobs/cron`, `jobs/view` | Cancel/retry, notifications, routine CRUD and cron evaluation, job display helpers                                                                                                                                                                                    |
| `chat/route`                                                                    | `handleChat(req, { userId, locale })`: the streaming endpoint for `useChat` (body shape documented in the file)                                                                                                                                                       |
| `chat/*`                                                                        | Message merging and compaction views, bubbles, reply/reaction actions, group mentions, run state                                                                                                                                                                      |
| `agent`                                                                         | Instructions, tools (`createDeniTools`, filtered by `offeredTools`), approval gates, handoffs, history, compaction, skills, artifacts                                                                                                                                 |
| `teammates`, `teammates/tools`                                                  | Teammate CRUD with the plan limit, tool groups (`TEAMMATE_TOOL_GROUPS`) and computer access                                                                                                                                                                           |
| `computer`, `computer/providers`                                                | Computer state, workspace files, the E2B `SandboxProvider` and Steel `BrowserProvider`                                                                                                                                                                                |
| `mcp`                                                                           | MCP connections (encrypted secrets and OAuth), discovery, calls, always-allow, explanations                                                                                                                                                                           |
| `billing/usage`, `billing/plans`                                                | Budget checks and cost charging through the shared engine; teammate limits per plan (Free 5, Go 10, Plus 15, Pro 25)                                                                                                                                                  |
| `i18n/standalone`, `i18n/localize-error`                                        | Server-side English/Japanese messages (persisted messages, background jobs, API errors)                                                                                                                                                                               |

## Usage

Run spends the same monthly pool as Deni AI chat and Flixa, through the shared engine.
Model calls spend it exactly like chat (`beginModelUsage` in `billing/usage.ts`): an
estimate is reserved before a turn (refused when the pool and the Max Mode credits are
spent), the real amount (`modelUsageUnits`: weighted tokens times the model's usage tier,
`@deniai/ai/usage-amount`) is settled when the turn ends, what goes past the pool is paid
from Max Mode credits, and the tool loop stops once the turn's allowance is spent.
Browser and computer time is recorded with `recordRunCost` (product `run`, metrics
`browser`, `computer`, micro-dollars) at the hourly rates above after it is incurred; it
stops once the pool is spent and Max Mode credits do not pay for it. The models are the
chat catalog's (`@deniai/ai/models`), with the chat plan access rules, called through the
Deni AI API like chat's (`@deniai/ai/provider`): the account's Run mode is `<model>@<effort>` (`agent/model.ts`,
the chat default model for a new account), and a model the plan or the server does not
allow falls back (`effectiveRunMode`). There is no HTTP integration inside
the platform (the legacy `/api/integrations/deni-run/usage` endpoint has been retired).

## Left in the hosts or dropped

- Authentication, rate limiting and request locale: the host (web app) passes `userId`
  and `locale`.
- Run's own Better Auth (Google/GitHub/Deni AI OAuth, 2FA, passkeys), Stripe billing
  remnants, the D1 proxy and the `rate_limits` table: replaced by the platform.
- The client chat session manager (`chat/sessions.ts`, `@ai-sdk/react`) is client code;
  the web app has its own.
- Built-in Gmail, Google Drive and GitHub plugins: they used Run's own OAuth accounts
  with extra scopes. They report `available: false` and refuse to run until the
  platform requests those scopes; stored always-allow rules are kept.
- Local Playwright browser and host shell fallbacks: without Steel or E2B the browser and
  terminal tools are not offered (no commands run on the host).
