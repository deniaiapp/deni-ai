# Framework

The app runs on TanStack Start (Vite and Nitro), not Next.js. Routes live in `src/routes/` and
`src/routeTree.gen.ts` is generated from them. The installed packages ship guides: read
`node_modules/@tanstack/react-start/skills/` and the skills it links to before changing routes,
server functions, or middleware.

UI strings are English source text passed to `useExtracted()` (components, from `@/i18n/react`),
`getExtracted()` (server code, from `@/i18n/server`), or `headTranslator()` (route `head`). They are
looked up in `src/i18n/messages/*.po` with use-intl. `pnpm dev`, `pnpm build`, and
`pnpm messages:extract` add new strings to the catalogs; translate the empty `msgstr` entries in
`src/i18n/messages/ja.po`.

# Layout

`@/` points at `src/`. Import across top-level folders (`lib` to `i18n`) with `@/`; keep relative
imports within one area.

- `src/routes/`: pages and API routes. `src/router.tsx` and `src/start.ts` set up the app.
- `src/components/`: `ui/` (shadcn) and `ai-elements/` are generic; `common/`, `account/`, `chat/`,
  `connectors/`, `workspace/`, and `marketing/` hold the app's own components.
- `src/lib/`: server and shared logic grouped by domain: `agent/`, `auth/`, `billing/`, `chat/`,
  `computer/`, `data/` (store, object storage, paths), `discord/`, `emails/`, `jobs/` (jobs,
  routines, scheduler), `mcp/` (MCP and built-in plugins), `teammates/`, and `ui/`.
- `src/db/`: Drizzle schema, executors, and SQL migrations.
- `src/i18n/`: use-intl setup, catalogs in `messages/`, and `standalone.ts`, the translator for code
  that runs outside a request.
- `src/server/`: `background.ts` (Nitro plugin) and `worker.ts` (`pnpm worker`) start the scheduler
  and the Discord bot.
- `tests/`: the `pnpm test:core` scripts (plain `tsx` files) and the standalone smoke test.
- `scripts/`: dev and maintenance scripts; `scripts/vite/` holds the Vite plugins.
- `services/d1-proxy/`: the Cloudflare Worker in front of D1, deployed with `pnpm d1:deploy`.

# Commit messages

Follow `CONTRIBUTING.md`. Husky and commitlint reject commits that do not match.

Format:

```
type(scope): short imperative summary

Body that explains why, not only what. Required. At least 20 characters.
```

- Scope is required. Combine several with commas and no spaces: `chore(web,api,db)`.
- Allowed scopes: `web`, `api`, `db`, `auth`, `billing`, `agent`, `computer`, `docker`, `ci`, `docs`, `deps`, `config`.
- Header (including type, scope, and subject) is at most 72 characters. No trailing period. No Title Case or ALL CAPS. Wrap body lines at 100 characters.
- Example: `feat(web): show usage meters on the upgrade page`

