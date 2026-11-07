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
- Group mentions (`@everyone` or `@name`) with parallel, individually attributed replies
- Durable background jobs with checkpoints, reconnect, cancellation, retries, and restart recovery
- Per-task browser pages with the account login profile and workspace files shared safely
- Generic streamable HTTP/SSE MCP connections with encrypted credentials and approval-gated calls
- Deliverable cards with safe text preview, download, and revision requests
- Persistent in-app notifications for completed, failed, approval, and takeover states, read automatically for the conversation on screen
- Animated character icons for teammates and groups (they hold still when the system asks for reduced motion); the default teammates start with their own, and their untouched names follow the workspace language
- Chat with teammates in Discord direct messages, with Approve and Deny buttons for gated actions

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

Copy `.env.example` to `.env.local` and configure Better Auth, Google/GitHub OAuth, Postgres, and an encryption key. Set the OAuth redirect URIs to `{BETTER_AUTH_URL}/api/auth/callback/google` and `{BETTER_AUTH_URL}/api/auth/callback/github`.

Plugins can link Gmail, Google Drive, and GitHub through these OAuth providers. Enable Gmail API and Drive API in the Google Cloud project and configure its consent screen for `gmail.readonly`, `gmail.send`, `drive.readonly`, and `drive.file` scopes; Gmail scopes can require Google verification for public use. GitHub uses the `repo` scope to access private repositories (GitHub OAuth does not offer a read-only private-repository scope); Deni Run gates all write operations behind per-action approval by default. Google Drive writes are limited to files created with this app by `drive.file`, and binary files are metadata-only in the agent. OAuth linking requires a normal signed-in session, not the local auth bypass.

For local development without OAuth, set `LOCAL_AUTH_BYPASS=true` in `.env.local` and run `pnpm dev`. Open `http://localhost:3000` (or `127.0.0.1`). The app creates a dedicated `local-dev-user` in Postgres and skips sign-in and 2FA for that user. This only works in development on localhost; do not enable it on a shared server. Better Auth client-side account actions (profile, sign-out, 2FA) still require a real session.

```bash
cp .env.example .env.local
pnpm db:migrate
```

If the database already contains the original tables but `drizzle.__drizzle_migrations` has no
baseline row, do not drop or reset it. Compare the live schema with `src/db/migrations/0000_init.sql`
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

The app is built with TanStack Start on Vite. `pnpm build` writes a self-contained Node server to
`.output/`, and `pnpm start` runs it. UI text is translated with use-intl from `src/i18n/messages/*.po`:
`pnpm dev` and `pnpm build` add new strings to the catalogs (or run `pnpm messages:extract`), and
untranslated entries in `src/i18n/messages/ja.po` have an empty `msgstr` that falls back to English.

http://localhost:3000

## Docker / Dokploy

Production uses Steel for the browser and E2B for the terminal, so the image does not install Chromium. Set `STEEL_API_KEY`, `E2B_API_KEY`, and S3/R2 credentials. Set `EXA_API_KEY` to give teammates a `webSearch` tool backed by Exa; without it the tool is not offered. `NEXT_PUBLIC_*` values are inlined at image build time — change them and rebuild.

```bash
cp .env.example .env
# fill BETTER_AUTH_SECRET, Google/GitHub OAuth, D1_PROXY_URL, D1_PROXY_TOKEN, APP_ENCRYPTION_KEY, and the keys above
pnpm db:migrate
docker compose up --build
```

Compose does not bind host port 3000 (Dokploy routes through Traefik). For a local bind, add `ports: ["3000:3000"]` under `app` temporarily.

On Dokploy, create a **Compose** service from this repo (`docker-compose.yml`). Put the same variables in the Environment tab (Dokploy writes `.env` next to the compose file). Set `D1_PROXY_URL` and `D1_PROXY_TOKEN` for the d1-proxy Worker (see `docs/d1-migration.md`). Point the domain at service `app`, container port `3000`. Run `pnpm db:migrate` (applies `src/db/migrations` to D1) before rolling out a schema change. The app container does not migrate on start. The routine scheduler is on by default (`DENI_SCHEDULER=true`). Keep a single app replica, or set `DENI_SCHEDULER=false` on extras.

Dockerfile-only deploys: build type **Dockerfile**, port `3000`, health check `/api/health`. Pass `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` as build arguments.

## Usage

1. Give a task to Chief, Research, or Operations
2. Watch clicks and file changes in Computer on the right
3. Select "Take control" when a login is required
4. Ask "Summarize the inbox every Monday at 9:00" to create a routine
5. Open **MCP connections** to add a streamable HTTP or SSE server, test discovery, and then ask a teammate to use it

The message box works like Deni AI's: **+** attaches photos or files (also by drag and drop or
paste, up to 10 files of 10 MB each). They are saved under `/inbox/web/` in the workspace and the
teammate is told where they are. The row under the text, shown while the box is in use, picks Run
or Run+ and the reasoning level; on narrow screens the level is in the **+** menu.

In a group conversation, type `@` to pick a teammate. `@everyone` calls every member;
`@Research` calls only that teammate. Messages without a mention go to all group
members in parallel. Each response shows its author's avatar and name.
Right-click a DM or group to pin it, mark it unread, hide it, or edit its profile.
Profiles support emoji icons and uploaded images. Groups can also be duplicated
or deleted without deleting their teammates. Open **Skills** to edit a skill's
name and Markdown instructions, or create a new one.

Routine cron expressions are evaluated in the account timezone, including day-of-month/day-of-week
rules, daylight-saving transitions, and monthly schedules. Invalid expressions are rejected when saved.

Local development workspace mirror: `.deni/users/<user-hash>/workspace`  
Local development browser profile: `.deni/users/<user-hash>/browser-profile`

## SaaS architecture

Better Auth provides authentication in-process. Sign-in is a Deni AI account (OAuth/OIDC against Deni AI), Google, or GitHub, then a second factor the user picks at setup: a passkey, an emailed code, or an authenticator app (TOTP). Passkeys must be unlocked with a fingerprint, face, or screen lock PIN, can also sign in on their own, and work only on accounts that chose them; switching methods deletes them. The passkey relying party is the hostname of `BETTER_AUTH_URL`, so passkeys registered on one domain do not work on another. Email codes are offered when `RESEND_API_KEY` and `EMAIL_FROM` are set, turn on only after the user enters the first code, and are limited to 5 per account per 15 minutes. Users, sessions, linked OAuth accounts, authenticator secrets, and passkey public keys live in Postgres. All bots, threads, routines, skills, computer state, and encrypted user configuration are stored in Postgres with that user ID as the tenant key.

Workspace files and screenshots use the configured S3-compatible bucket (Cloudflare R2), namespaced by user. Browser automation uses a persistent Steel profile per user. Terminal commands run inside a per-user E2B sandbox.

Deni Run has no billing of its own. Every user links a Deni AI account, whose plan sets one monthly (UTC) usage pool, priced in USD and shared by Deni AI chat, Flixa, and Deni Run. Deni Run spends it with model calls at the cost OpenRouter reports and browser (Steel) and computer (E2B) time at `DENI_RUN_BROWSER_USD_PER_HOUR` / `DENI_RUN_COMPUTER_USD_PER_HOUR` (defaults 0.10 and 0.15). Deni AI keeps the ledger; both apps show the pool as percentages, split by product (Deni AI chat, Flixa, Deni Run). Usage is not split into basic and premium models:

| Deni AI plan | Free | Go | Plus | Pro |
| --- | --- | --- | --- | --- |
| Monthly usage pool | $10 | $30 | $100 | $200 |
| Teammates | 5 | 10 | 15 | 25 |

Setup:

1. In Deni AI, register the OAuth client: `pnpm run tools:register-oauth-client --name="Deni Run" --redirect-uri={BETTER_AUTH_URL}/api/auth/callback/deni-ai`, and set the printed client id as Deni AI's `DENI_RUN_OAUTH_CLIENT_ID`.
2. Here, set `DENI_AI_URL`, `DENI_AI_CLIENT_ID`, and `DENI_AI_CLIENT_SECRET` (sign-in and account linking).
3. Set the same random `DENI_RUN_SERVICE_SECRET` in both apps (usage checks and reports to `{DENI_AI_URL}/api/integrations/deni-run/usage`).

Work is refused until the account is linked or once the pool is spent (by any of the three products). Without `DENI_RUN_SERVICE_SECRET` a development server runs unmetered; production refuses work.

Run the scheduler on exactly one dedicated worker instance with `DENI_SCHEDULER=true`. Do not enable it on every web replica.

## Discord

Teammates can be reached from Discord direct messages through one shared bot.

1. In the [Discord Developer Portal](https://discord.com/developers/applications) create an application and add a bot. No privileged intents are needed: direct messages carry their text without Message Content access.
2. Set `DISCORD_BOT_TOKEN` and `DISCORD_INVITE_URL`, the install link shown on the Discord card (in the Portal open **Installation**, enable **User Install**, and copy the **Install Link**; without it users cannot find the bot). The bot connects from the instance that runs the scheduler (`DENI_SCHEDULER=true`, or `pnpm worker`). Set the token on web instances too, or the settings card stays hidden.
3. Run `pnpm db:migrate` to create the `discord_links` and `discord_link_codes` tables.
4. In the app open **Plugins**, choose **Create link code** on the Discord card, and send the code to the bot in a direct message (or use `/link`). The code works once and expires after 10 minutes.

After linking, a plain direct message goes to the chosen teammate (or group) and the reply comes back in the same conversation, which is also visible in the web app. Files attached to a message are saved under `/inbox/discord/` in the workspace and the teammate is told where they are. Everything in the app except account and billing settings is available as a slash command; `/help` lists them in the person's language:

| Command | What it does |
| --- | --- |
| `/teammate`, `/model`, `/effort`, `/reset` | Choose who you talk to, the model and reasoning level, and start a conversation over |
| `/team` | List, create, edit, and delete teammates; view and forget their memory |
| `/group` | List, create, edit, and delete groups; `talk` sends plain messages to a group (`@name` or `@everyone` picks who answers) |
| `/tasks` | Running and recent tasks with Stop and Retry; `stop` cancels the current conversation's task |
| `/files` | Browse, download (folders as zip), and delete workspace files; get deliverables |
| `/skill`, `/routine` | Manage skills and scheduled routines, including the default timezone |
| `/computer` | Status and screenshots, close the browser, pause the sandbox |
| `/plugins`, `/mcp` | Plugin status, disconnect, and always-allow rules; add, test, enable, and delete MCP servers |
| `/notify`, `/inbox` | Turn background-work notifications on or off, and read unread ones |
| `/unlink` | Disconnect the Discord account |

Routine results are also sent as a direct message while `/notify` is on (the default); chat replies are not, because they already arrive in the conversation. Connecting Gmail, Drive, or GitHub needs a browser sign-in, and controlling the browser needs the app, so those commands reply with a link built from `BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`). Notifications are sent through Discord's REST API from whichever instance creates them, so set `DISCORD_BOT_TOKEN` on the scheduler or worker instance too.

Commands that need approval, file deletion, and plugin writes arrive as a message with **Approve** and **Deny** buttons; the task resumes after you answer. A step that needs the browser (login, 2FA, CAPTCHA) cannot be done in Discord, so the bot asks you to finish it in the app. Only direct messages are served, never server channels, because a teammate's answer can contain private data.

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
