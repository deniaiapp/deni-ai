# Deni Run

An AI teammate workspace inspired by Grok Bot. Hand work to named AI teammates and let them finish it on an isolated computer (browser, files, and terminal). The model is `openai/gpt-5.6-luna` through OpenRouter with `max` reasoning effort.

While Grok Bot provides a cloud VM, Deni Run gives each account an isolated computer. Sessions, files, and memory stay scoped to that account.

## Features

- Message teammates and hand them work; no workflow builder is required
- Shared computer: browser control, workspace files, and shell commands
- Take control while watching the screen (login / 2FA / CAPTCHA)
- Skills for reusable procedures and cron-based routines
- Approval gates for destructive commands and file deletion
- Handoffs between bots and group threads
- Durable background jobs with checkpoints, reconnect, cancellation, retries, and restart recovery
- Per-task browser pages with the account login profile and workspace files shared safely
- Generic streamable HTTP/SSE MCP connections with encrypted credentials and approval-gated calls
- Deliverable cards with safe text preview, download, and revision requests
- Persistent in-app notifications for completed, failed, approval, and takeover states

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

Copy `.env.example` to `.env.local` and configure Better Auth, Google/GitHub OAuth, Postgres, and an encryption key. Set the OAuth redirect URIs to `{BETTER_AUTH_URL}/api/auth/callback/google` and `{BETTER_AUTH_URL}/api/auth/callback/github`.

```bash
cp .env.example .env.local
pnpm db:migrate
```

If the database already contains the original tables but `drizzle.__drizzle_migrations` has no
baseline row, do not drop or reset it. Compare the live schema with `db/migrations/0000_init.sql`
and have the database owner record that known baseline with the team's migration tooling before
applying `0001_wakeful_king_cobra.sql`. `pnpm test:core` validates both migrations in a temporary
schema without touching application data.

For long-running work, run the dedicated worker in a separate process (and set `DENI_SCHEDULER=true`):

```bash
pnpm worker
```

The worker claims queued jobs with a database lease. If a worker stops while a tool call is in
flight, the job is marked **needs review** instead of replaying an uncertain external side effect.
Use the task's explicit review-and-retry action after checking the external service.

Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys) and set `OPENROUTER_API_KEY` for a platform-managed key. If it is omitted, each signed-in user can provide their own key in the setup screen; it is encrypted before being stored.

```bash
pnpm dev
```

http://localhost:3000

## Docker / Dokploy

### Local PostgreSQL

No Docker or system-wide PostgreSQL installation is needed. After installing the
project dependencies with Bun or pnpm (Node.js is required):

```bash
bun db:start
```

This uses the platform's native PostgreSQL 17 binaries supplied by `embedded-postgres`.
It initializes `.deni/postgres/data` once, creates the `deni` database, and starts the
server in the background using `pg_ctl`. Repeated starts reuse the running server.
Supported platforms include Windows x64, macOS x64/ARM64, and Linux x64/ARM64.
For the local app and migrations, set this in `.env.local`:

```dotenv
DATABASE_URL=postgres://deni:deni@127.0.0.1:5432/deni
```

Then run `bun db:migrate` and `bun dev`. The local database starts empty; this command
does not migrate existing Neon data or rewrite your current connection settings.
Use `bun db:stop` for a clean shutdown without deleting data, `bun db:status` to
check whether it is running, and `bun db:logs` to follow its logs (Ctrl+C exits the
log viewer without stopping PostgreSQL).
If port 5432 is occupied, set `LOCAL_POSTGRES_PORT` in `.env.local` and use that same
port in `DATABASE_URL`. Local credentials are `deni` / `deni`, and the port is bound
only to `127.0.0.1`. Native database files are separate from any previous Docker
volume. Native binary installation hooks are allowed in the package-manager config;
if installing with lifecycle scripts disabled, allow the `@embedded-postgres/*`
package for your platform before starting the database.

### Dokploy PostgreSQL

Compose includes a PostgreSQL 17 service named `postgres`, with persistent storage in
the `postgres-data` volume and a readiness health check. PostgreSQL is published only
on the server's loopback address at `127.0.0.1:15433`. In Tabby, configure a local SSH
forward from local `127.0.0.1:15432` to remote `127.0.0.1:15433` on this server.
The local database URL then uses port `15432`; the app container still uses
`postgres:5432` internally.
Set `POSTGRES_PASSWORD` in Dokploy's Environment tab before deploying; `POSTGRES_DB`
and `POSTGRES_USER` default to `deni`. A hex password from `openssl rand -hex 32` can
be used directly in the connection URL.

The app continues to use the existing `DATABASE_URL`. When ready to switch to the
included database, set it to `postgres://deni:<password>@postgres:5432/deni` (adjust
the username and database if changed). This is a new, empty database: existing Neon
data is not copied automatically, and application schema migrations are still required.
Keep the `postgres-data` volume when redeploying. Changing the initialization variables
does not change the credentials or database in an already initialized volume.

Production uses Steel for the browser and E2B for the terminal, so the image does not install Chromium. Set `STEEL_API_KEY`, `E2B_API_KEY`, and S3/R2 credentials. Set `EXA_API_KEY` to give teammates a `webSearch` tool backed by Exa; without it the tool is not offered. `NEXT_PUBLIC_*` values are inlined at image build time — change them and rebuild.

```bash
cp .env.example .env
# fill BETTER_AUTH_SECRET, Google/GitHub OAuth, DATABASE_URL, APP_ENCRYPTION_KEY, and the keys above
pnpm db:migrate
docker compose up --build
```

Compose does not bind host port 3000 (Dokploy routes through Traefik). For a local bind, add `ports: ["3000:3000"]` under `app` temporarily.

On Dokploy, create a **Compose** service from this repo (`docker-compose.yml`). Put the same variables in the Environment tab (Dokploy writes `.env` next to the compose file). Point `DATABASE_URL` at your Postgres instance. Point the domain at service `app`, container port `3000`. Run `pnpm db:migrate` (`drizzle-kit migrate`) against that database before rolling out a schema change. The app container does not migrate on start. The routine scheduler is on by default (`DENI_SCHEDULER=true`). Keep a single app replica, or set `DENI_SCHEDULER=false` on extras.

Dockerfile-only deploys: build type **Dockerfile**, port `3000`, health check `/api/health`. Pass `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` as build arguments.

## Usage

1. Give a task to Chief, Research, or Operations
2. Watch clicks and file changes in Computer on the right
3. Select "Take control" when a login is required
4. Ask "Summarize the inbox every Monday at 9:00" to create a routine
5. Open **MCP connections** to add a streamable HTTP or SSE server, test discovery, and then ask a teammate to use it

Routine cron expressions are evaluated in the account timezone, including day-of-month/day-of-week
rules, daylight-saving transitions, and monthly schedules. Invalid expressions are rejected when saved.

Local development workspace mirror: `.deni/users/<user-hash>/workspace`  
Local development browser profile: `.deni/users/<user-hash>/browser-profile`

## SaaS architecture

Better Auth provides authentication in-process. Sign-in is Google or GitHub, then TOTP two-factor. Users, sessions, linked OAuth accounts, and authenticator secrets live in Postgres. All bots, threads, routines, skills, computer state, and encrypted user configuration are stored in Postgres with that user ID as the tenant key.

Workspace files and screenshots use the configured S3-compatible bucket (Cloudflare R2), namespaced by user. Browser automation uses a persistent Steel profile per user. Terminal commands run inside a per-user E2B sandbox.

Usage is metered per account and month (UTC):

| | Free | Pro ($20/mo) |
| --- | --- | --- |
| Tokens | 10M | 200M |
| Browser minutes (Steel) | 30 | 600 |
| Computer minutes (E2B) | 30 | 600 |
| Teammates | 5 | 25 |

Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, and `STRIPE_WEBHOOK_SECRET` to enable upgrades. Create a Stripe Price for the Pro plan and point the webhook at `/api/billing/webhook` (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`).

Run the scheduler on exactly one dedicated worker instance with `DENI_SCHEDULER=true`. Do not enable it on every web replica.

## Grok Bot mapping

| Grok Bot | Deni Run |
| --- | --- |
| Named bots | Teammates |
| Account-shared cloud VM | Shared computer in `.deni` |
| Agent Computer preview | Screen in the right pane |
| Take control | Take control |
| Skills / Routines | Skills / Routines |
| Approvals | Approve / Deny |
| SuperGrok / Cursor plans | Free / Pro usage limits |

## Notes

Bots execute shell commands inside an isolated E2B sandbox. Destructive commands and file deletes require approval. Web page content is treated as untrusted. You can export or delete stored account data at `/account`.
