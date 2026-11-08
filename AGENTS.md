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
| `packages/disposable-email-domains` | `@deni-ai/disposable-email-domains` | Disposable email domain list                                                                                                                                                         |
| `packages/db`                       | `@deniai/db`                        | Drizzle schema + migrations: `public` (web, `drizzle.config.ts`) and `flixa` (agent API, `drizzle.flixa.config.ts`, journal `flixa.__drizzle_migrations`)                            |
| `packages/billing`                  | `@deniai/billing`                   | Pure billing rules shared by web and agent API: usage pool sizes, units per USD, usage tier multipliers, token weights, education domains                                            |
| `packages/flixa-contract`           | `@deniai/flixa-contract`            | Publishable (0.1.0, not published) zod schemas + types of the public Flixa API: device auth, API key format, error envelope and codes, client headers, models, usage, request bodies |

The apps were imported with their full history (`git subtree add`), so
`git log -- apps/web` shows the deni-ai history.

Planned packages (not started): `packages/auth` (better-auth config and API key
validation shared by web and agent API), `packages/ai` (model registry and
provider clients), `packages/i18n` (use-intl catalogs and extraction),
`packages/emails` (react-email templates) and `packages/ui` (shadcn/ui
components). Reservation and settlement logic moves in a later phase; Deni Run
(deni-ai-computer) is not imported yet.

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
- Values that both apps depend on belong in a package, not in hand-synced
  copies: schema in `@deniai/db`, billing constants in `@deniai/billing`, public
  Flixa response shapes in `@deniai/flixa-contract` (change the contract and its
  tests with the server, and bump its version when the public shape changes).
- `@deniai/flixa-contract` is the only publishable package: workspace consumers
  use its TypeScript source, `pnpm --filter @deniai/flixa-contract build` emits
  `dist/`, and `publishConfig` points the packed `exports` there. Server code
  imports it with `import type` only, so zod stays out of the agent API bundle.
- Dockerfiles live next to each app and are built from the repository root
  (`docker build -f apps/web/Dockerfile .`); `<Dockerfile>.dockerignore` next to
  each Dockerfile applies. When a package is added, the Dockerfiles already copy
  `packages/`; add its manifest only if it lives elsewhere.
- Never run `db:migrate`, `db:push` or `auth:generate` without an explicit
  request for the target environment.

## Commands (from the root)

| Command                                   | Effect                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                                | Web dev server (`@deniai/web`, port 3000)               |
| `pnpm dev:support` / `pnpm dev:agent-api` | Other dev servers (both also default to port 3000)      |
| `pnpm build`                              | `build` in every package that has one                   |
| `pnpm lint` / `pnpm format`               | oxlint / oxfmt in every package that defines the script |
| `pnpm typecheck`                          | `tsc --noEmit` everywhere                               |
| `pnpm test`                               | vitest (web, packages) and `node --test` (agent-api)    |
| `pnpm --filter <name> <script>`           | One package, e.g. `pnpm --filter @deniai/web typecheck` |

Each app reads its own env files from its directory (`apps/web/.env.local`,
`services/agent-api/.env`, `apps/support/.env.local`); see
`apps/web/.env.example`, `apps/support/.env.example` and the agent API README.
`@deniai/db` migration scripts read `apps/web/.env*` (public schema) and
`services/agent-api/.env` (flixa schema).

## Verification

Run the checks of every package a change touches, plus the consumers of a
changed shared package (`pnpm --filter "...@deniai/<pkg>" typecheck`). See the
app guides for runtime checks.

## Git policy

Daily work lands on `canary`; `master` is the release target. Use conventional
commits. Do not push, force-push or open PRs unless explicitly requested.
