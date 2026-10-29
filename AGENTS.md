# Repository Guidelines

## Project Structure & Module Organization
`app.ts` builds the Hono app (middleware plus the `/v1` routers). `server.ts` is the Node.js entrypoint (`@hono/node-server`) and `worker.ts` the Cloudflare Workers entrypoint; both only wrap `app.ts`. Read config via `process.env` so code runs on both runtimes. Route handlers live in `routes/v1/` (`agent.ts`, `deni.ts`, `models.ts`). Shared request guards live in `middleware/`; `middleware/validateAgentAuth.ts` enforces the client access policy (Free/Go only from the listed clients, otherwise a 403 plan notice without a ban; Plus and above from any client; see the README). Domain logic is grouped under `utils/`: `utils/agent/` for model routing and upstream clients, `utils/deni/` for auth, billing, usage, and DB access, and `utils/flixa-sdk.ts` for the local client.

There is no dedicated `src/` folder; keep new modules close to the feature they support. Follow the existing split: route layer in `routes/`, reusable logic in `utils/`, cross-cutting concerns in `middleware/`.

## Build, Test, and Development Commands
Requires Node.js 26+ and pnpm. Install dependencies with `pnpm install`. TypeScript runs directly through `tsx`; `.env` is loaded if present.

- `pnpm start`: start the API locally (`tsx server.ts`).
- `pnpm dev`: start with auto-reload (`tsx watch`).
- `pnpm run dev:prod-env`: run against `.env.production` env vars.
- `pnpm run build`: bundle `server.ts` with esbuild into `dist/server.js` (run it with `pnpm run start:dist`).
- `pnpm test`: run the test suite (`node:test` via `tsx --test`).
- `pnpm run typecheck`: run TypeScript checks with `tsc --noEmit`.
- `pnpm run dev:worker` / `pnpm run deploy:worker`: run on local workerd / deploy to Cloudflare Workers (`wrangler.toml`). DB goes through the `DENI_DB` Hyperdrive binding; secrets via `pnpm exec wrangler secret put <NAME>`.
- `pnpm exec oxlint .` and `pnpm exec oxfmt . --check`: optional lint/format validation using installed tools.

## Coding Style & Naming Conventions
Use TypeScript and keep modules small and single-purpose. Match the surrounding file style rather than reformatting unrelated code. Existing code uses:

- `camelCase` for variables/functions
- `PascalCase` for types/classes
- short route files named by endpoint, for example `routes/v1/deni.ts`

Prefer explicit return types on exported functions and keep API error payloads consistent with current Hono handlers.

## Testing Guidelines
Tests live in `tests/*.test.ts` and use `node:test` with `node:assert/strict`; run them with `pnpm test`. Module-level mocks use `mock.module()` (enabled by `--experimental-test-module-mocks` in the test script). At minimum, run `pnpm run typecheck` and `pnpm test` before opening a PR. For endpoint changes, verify manually with `curl` or a REST client against `/health`, `/v1/agent/chat/completions`, or the affected `/v1/deni/*` route.

If you add tests, place them near the feature or under a top-level `tests/` directory and use descriptive names such as `deni-usage.test.ts`.

## Commit & Pull Request Guidelines
Use Conventional Commits. Current history favors prefixes like `fix:` and `feat:`; keep subjects short and lowercase, for example `fix: handle null Deni billing plan ids`.

PRs should include:

- a brief description of the change and user-facing impact
- linked issue or context when applicable
- manual verification steps
- sample requests/responses for API behavior changes

## Security & Configuration Tips
Do not commit real API keys or database URLs. Keep secrets in `.env` or deployment-managed env vars such as `DENI_AI_API_KEY` (OpenAI models via Deni AI API), `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, and `DENI_DATABASE_URL`.

Admin UI (`/admin/*`) uses a **cookie session** via `/admin/login` (`ADMIN_USER` / `ADMIN_PASSWORD`). Do not rely on browser HTTP Basic Auth dialogs for day-to-day admin access — Chrome often caches bad Basic credentials and then spins forever on 401 when revisiting later. Scripts may still send `Authorization: Basic …` unless `ADMIN_ALLOW_BASIC=false`.

Admin security env:

| Env | Purpose |
|-----|---------|
| `ADMIN_PASSWORD` | Required; prefer 16+ random chars |
| `ADMIN_USER` | Optional username (default `admin`) |
| `ADMIN_COOKIE_SECURE` | Force `Secure` session cookie (`true` recommended behind HTTPS) |
| `ADMIN_SESSION_DAYS` | Session lifetime (default 7, max 30) |
| `ADMIN_SESSION_SECRET` | Recommended; 32+ random bytes used to sign session cookies. When unset, the key is PBKDF2-derived from `ADMIN_PASSWORD`. Changing it (or `ADMIN_PASSWORD`) logs out all admin sessions |
| `ADMIN_ALLOW_BASIC` | Allow HTTP Basic for scripts (default on; set `false` to disable) |
| `ADMIN_IP_ALLOWLIST` | **Optional.** Comma-separated IPs / IPv4 CIDRs. Leave empty for mobile / changing IPs |

Do **not** require IP allowlist if you log in from mobile or CGNAT — the address changes and you will lock yourself out. Prefer a long `ADMIN_PASSWORD`, login rate limits, and HTTPS. Allowlist is only useful for fixed office / VPN egress IPs.

Failed logins are rate-limited, delayed slightly, and logged as `[AdminAuth] login_failed` (password never logged). Startup warns on weak passwords and on a short (or, in production, missing) `ADMIN_SESSION_SECRET` only.

### Rate limiting
In-process fixed-window limits (per instance). Disable with `RATE_LIMIT_ENABLED=false`.

| Scope | Env | Default |
|-------|-----|---------|
| `/v1/*` by IP | `RATE_LIMIT_IP_MAX` / `RATE_LIMIT_IP_WINDOW_MS` | 180 / 60s |
| Authenticated user | `RATE_LIMIT_USER_MAX` / `RATE_LIMIT_USER_WINDOW_MS` | 90 / 60s |
| Admin login POST | `RATE_LIMIT_ADMIN_LOGIN_MAX` / `RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS` | 20 / 15m |

**Exempt (no short-window rate limit):** agent inference paths —  
`/v1/agent/chat/completions`, `/v1/agent/responses`, `/v1/agent/responses/compact`,  
`/v1/messages`, `/v1/agent/messages`, `/v1/agent/v1/messages`  
(these still use monthly usage quota).

Responses use `429` + `Retry-After` / `X-RateLimit-*` headers. This is separate from monthly usage quota.

## Shell pitfalls (Windows)
Do **not** create or commit a repo-root file named `nul` (or other Windows reserved names like `con`, `prn`, `aux`).

On `cmd`, `> nul` / `2>nul` discards output. In **Git Bash / MSYS**, `nul` is a normal path, so redirects such as `command 2>nul` write a real `./nul` file. Prefer:

- bash: `command 2>/dev/null`
- PowerShell: `command 2>$null`
- cmd only: `command 2>nul`

If a stray `nul` appears, delete it (Windows may need an extended path: `\\?\D:\devs\flixa-backend\nul`) and never add it to git.
