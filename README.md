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

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

Copy `.env.example` to `.env.local` and configure Clerk, Postgres, and an encryption key:

```bash
cp .env.example .env.local
pnpm db:migrate
```

Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys) and set `OPENROUTER_API_KEY` for a platform-managed key. If it is omitted, each signed-in user can provide their own key in the setup screen; it is encrypted before being stored.

```bash
pnpm dev
```

http://localhost:3000

## Docker / Dokploy

Production uses Steel for the browser and E2B for the terminal, so the image does not install Chromium. Set `STEEL_API_KEY`, `E2B_API_KEY`, and S3/R2 credentials. `NEXT_PUBLIC_*` values are inlined at image build time — change them and rebuild.

```bash
cp .env.example .env
# fill Clerk, POSTGRES_PASSWORD, APP_ENCRYPTION_KEY, and the keys above
docker compose up --build
```

http://localhost:3000

On Dokploy, create a **Compose** service from this repo (`docker-compose.yml`). Put the same variables in the Environment tab (Dokploy writes `.env` next to the compose file). For the bundled Postgres, set `DATABASE_URL=postgres://deni:<POSTGRES_PASSWORD>@postgres:5432/deni`. Point the domain at service `app`, port `3000`. The container runs migrations on start and enables the routine scheduler (`DENI_SCHEDULER=true`). Keep a single app replica, or set `DENI_SCHEDULER=false` on extras.

If Postgres is already provided by Dokploy, remove the `postgres` service and set `DATABASE_URL` to that instance.

Dockerfile-only deploys: build type **Dockerfile**, port `3000`, health check `/api/health`. Pass `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_SUPPORT_EMAIL` as build arguments.

## Usage

1. Give a task to Chief, Research, or Operations
2. Watch clicks and file changes in Computer on the right
3. Select "Take control" when a login is required
4. Ask "Summarize the inbox every Monday at 9:00" to create a routine

Local development workspace mirror: `.deni/users/<user-hash>/workspace`  
Local development browser profile: `.deni/users/<user-hash>/browser-profile`

## SaaS architecture

Clerk provides authentication. All bots, threads, routines, skills, computer state, and encrypted user configuration are stored in Postgres with the Clerk user ID as the tenant key.

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
