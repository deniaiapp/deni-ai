# Agent guide for the deni-ai monorepo

pnpm 12 workspace (Node.js 26+, TypeScript 7, oxlint, oxfmt, vitest). Each app
keeps its own `AGENTS.md`; read the one for the app you change. This file covers
the workspace layout and the rules that span apps.

## Layout

| Path                                | Package                             | What it is                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                          | `@deniai/web`                       | Deni AI web app (TanStack Start, React Compiler, better-auth). Guide: `apps/web/AGENTS.md`                                                                                           |
| `apps/support`                      | `@deniai/support`                   | Help center (support.deniai.app, Fumadocs on TanStack Start). See `apps/support/README.md`                                                                                           |
| `services/agent-api`                | `@deniai/agent-api`                 | Flixa agent API (Hono, formerly flixa-backend). Guide: `services/agent-api/AGENTS.md`                                                                                                |
| `services/run-worker`               | `@deniai/run-worker`                | Deni Run worker: job scheduler (routines, stale leases, claiming) and, behind `RUN_DISCORD_ENABLED`, the Discord bot. See `services/run-worker/README.md`                            |
| `packages/disposable-email-domains` | `@deni-ai/disposable-email-domains` | Disposable email domain list                                                                                                                                                         |
| `packages/db`                       | `@deniai/db`                        | Drizzle schema + migrations: `public` (web, `drizzle.config.ts`) and `flixa` (agent API, `drizzle.flixa.config.ts`, journal `flixa.__drizzle_migrations`)                            |
| `packages/billing`                  | `@deniai/billing`                   | Billing rules shared by web and agent API: pure pool sizes, plan tiers, usage tier multipliers, token weights, education domains; `/server`: the usage engine (`createUsageEngine`)  |
| `packages/flixa-contract`           | `@deniai/flixa-contract`            | Publishable (0.1.0, not published) zod schemas + types of the public Flixa API: device auth, API key format, error envelope and codes, client headers, models, usage, request bodies |
| `packages/client-contract`          | `@deniai/client-contract`           | Zod schemas, types and JSON Schema (`schema/client-api-v1.json`) of the native client API `/api/client/v1` used by Deni AI Desktop |
| `packages/ui`                       | `@deniai/ui`                        | shadcn/ui components on Base UI and layout primitives (PageHeader, PageSection, SettingsLayout, AppHeader) of the design system in `docs/design-system.md`                           |
| `packages/emails`                   | `@deniai/emails`                    | react-email transactional templates and `renderEmail()` (HTML + plain text)                                                                                                          |
| `packages/i18n`                     | `@deniai/i18n`                      | Locale list (web and support), Accept-Language negotiation, `getExtracted()`, and the `extractMessages()` Vite plugin that rewrites `apps/web/messages/*.json`                       |
| `packages/ai`                       | `@deniai/ai`                        | Chat model catalog and plan access rules, OpenRouter provider factory, reasoning helpers, pure chat tools (questionnaire)                                                            |
| `packages/auth`                     | `@deniai/auth`                      | Better Auth server factory `createAuth(deps)`, React client, auth route paths, API key generation and hashing (web and agent API)                                                    |
| `packages/run`                      | `@deniai/run`                       | Deni Run (Run mode, `/run/*`): teammates, threads, agent runtime, Postgres job queue, E2B/Steel providers, MCP, routines, D1 migration. See its README                               |

`docs/design-system.md` is the design brief of the web app (tokens, type, layout, screen
inventory, the `next`/`legacy` UI switch).

The apps were imported with their full history (`git subtree add`), so
`git log -- apps/web` shows the deni-ai history.

`packages/{emails,i18n,ai,auth,billing,run}` have READMEs listing their exports and
what stayed in the web app. Packages never import an app:
values that depend on env, the database or app services are passed in (for
example `apps/web/src/lib/auth.ts` calls `createAuth()` with its env, db, email
sender and callbacks). Usage reservation and settlement have one
implementation, `createUsageEngine(deps)` in `@deniai/billing/server`, used by the
web app and the agent API (`FLIXA_USAGE_ENGINE`, see
`packages/billing/docs/usage-engine.md`). Deni Run (deni-ai-computer) was imported with its history (`git subtree`, then
moved into `packages/run`, `services/run-worker` and `apps/web`); it runs as Run
mode in the web app under `/run/*` with its own `run_*` tables, charges the shared
pool through the same engine (`getRunBudget` / `recordRunCost`), and its standalone
D1 data moves over with `pnpm --filter @deniai/run migrate:d1` (runbook:
`docs/run-migration.md`).

## Workspace rules

- Install once at the root: `pnpm install`. There is a single root
  `pnpm-lock.yaml`; never add nested lockfiles or `pnpm-workspace.yaml` files.
  Workspace-wide `overrides`, `allowBuilds` and `minimumReleaseAgeExclude` live in
  the root `pnpm-workspace.yaml`.
- Workspace dependencies use `workspace:*`. Shared packages are consumed as
  TypeScript source (`exports` point at `src/`) unless the package says it is
  publishable.
- Every package `tsconfig.json` extends `tsconfig.base.json` and adds its own
  `target`, `lib`, `types`, `jsx` and `paths`. `@/*` stays an app-local alias.
- oxlint and oxfmt read the root `.oxlintrc.json` / `.oxfmtrc.json` (they search
  parent directories). `apps/support` keeps its own `.oxlintrc.json` and is not
  formatted with oxfmt (it uses single quotes); `services/agent-api` is not
  oxfmt-formatted either, so it has no `format` script.
- A package that imports `better-auth` (`@deniai/auth`) gets its own copy:
  pnpm resolves Better Auth's optional peers per importer. Apps that load the
  auth server or client through Vite list `authDedupe` from
  `@deniai/auth/dedupe` in `resolve.dedupe` (apps/web does, in `vite.config.ts`
  and `vitest.config.ts`) so one instance serves the app.
- Values that both apps depend on belong in a package, not in hand-synced
  copies: schema in `@deniai/db`, billing constants in `@deniai/billing`, public
  Flixa response shapes in `@deniai/flixa-contract` (change the contract and its
  tests with the server, and bump its version when the public shape changes).
  Usage rules (quota, reservations, team usage policy, Max Mode, product ledger)
  change only in `@deniai/billing/server`; both apps bind the same engine.
- `@deniai/flixa-contract` is the only publishable package: workspace consumers
  use its TypeScript source, `pnpm --filter @deniai/flixa-contract build` emits
  `dist/`, and `publishConfig` points the packed `exports` there. Server code
  imports it with `import type` only, so zod stays out of the agent API bundle.
- Dockerfiles live next to each app and are built from the repository root
  (`docker build -f apps/web/Dockerfile .`); `<Dockerfile>.dockerignore` next to
  each Dockerfile applies. Each image installs pnpm 12.18.0 (the root
  `packageManager`; bump them together) and runs a frozen install filtered to
  its app (`--filter "@deniai/<app>..."`). They copy `packages/*/package.json`
  before the install and the package sources after it, so source edits keep the
  install layer cached. When a package is added under `packages/`, nothing
  changes; add its manifest only if it lives elsewhere.
- Never run `db:migrate`, `db:push` or `auth:generate` without an explicit
  request for the target environment.
- During the v8 private beta the web app shares the production database with v7
  (the `deni-ai` repository): schema changes are made only in `packages/db`
  here and stay additive, and v7 does not generate migrations. Rollout, the
  beta gate and the coexistence switches: `docs/v8-beta-rollout.md`.

## Commands (from the root)

| Command                                   | Effect                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`                                | Web dev server (`@deniai/web`, port 3000)                                      |
| `pnpm dev:support` / `pnpm dev:agent-api` | Other dev servers (both also default to port 3000)                             |
| `pnpm --filter @deniai/run-worker dev`    | Run worker (scheduler; Discord only with `RUN_DISCORD_ENABLED=true`)           |
| `pnpm build`                              | `build` in every package that has one                                          |
| `pnpm lint` / `pnpm format`               | oxlint / oxfmt in every package that defines the script                        |
| `pnpm format:check`                       | `oxfmt --check` (web, ui, db, billing, flixa-contract, client-contract, emails, i18n, ai, auth) |
| `pnpm typecheck`                          | `tsc --noEmit` everywhere                                                      |
| `pnpm test`                               | vitest (web, packages) and `node --test` (agent-api)                           |
| `pnpm --filter <name> <script>`           | One package, e.g. `pnpm --filter @deniai/web typecheck`                        |

Each app reads its own env files from its directory (`apps/web/.env.local`,
`services/agent-api/.env`, `apps/support/.env.local`); see
`apps/web/.env.example`, `apps/support/.env.example` and the agent API README.
`@deniai/db` migration scripts read `apps/web/.env*` (public schema) and
`services/agent-api/.env` (flixa schema).

## CI

`.github/workflows/ci.yml` runs on pushes to `canary` and on pull requests:
`pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm test` and `pnpm build` (which must leave no diff,
e.g. an uncommitted `apps/web/messages/en.json` change), plus a job that runs
`drizzle-kit generate` for both `@deniai/db` configs offline and fails on
pending migrations. `react-doctor.yml` scans `apps/web` when the web app or a
package changes; `claude.yaml` answers `@claude` mentions. Renovate reads the
root `renovate.json`.

## Verification

Run the checks of every package a change touches, plus the consumers of a
changed shared package (`pnpm --filter "...@deniai/<pkg>" typecheck`). See the
app guides for runtime checks.

## Git policy

Daily work lands on `canary`; `master` is the release target. Use conventional
commits. Do not push, force-push or open PRs unless explicitly requested.
