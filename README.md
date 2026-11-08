# deni-ai (monorepo)

Trial monorepo for the Deni AI platform.

- `apps/web` — Deni AI web app
- `apps/support` — help center
- `services/agent-api` — Flixa agent API
- `packages/*` — shared workspace packages

```bash
pnpm install
pnpm dev          # apps/web on http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

See `AGENTS.md` for the layout and workspace rules.
