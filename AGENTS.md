# Repository Guidelines

## Project Structure & Module Organization
`server.ts` is the Bun entrypoint and wires Hono middleware plus the `/v1` routers. Route handlers live in `routes/v1/` (`agent.ts`, `deni.ts`, `models.ts`). Shared request guards live in `middleware/`. Domain logic is grouped under `utils/`: `utils/agent/` for model routing and upstream clients, `utils/deni/` for auth, billing, usage, and DB access, and `utils/flixa-sdk.ts` for the local client.

There is no dedicated `src/` folder; keep new modules close to the feature they support. Follow the existing split: route layer in `routes/`, reusable logic in `utils/`, cross-cutting concerns in `middleware/`.

## Build, Test, and Development Commands
Install dependencies with `bun install`.

- `bun run server.ts` or `bun start`: start the API locally.
- `bun --watch server.ts` or `bun dev`: start with auto-reload.
- `bun --env-file=.env.production --watch server.ts`: run against production-style env vars.
- `bun build server.ts --outdir ./dist --target bun`: create a build output in `dist/`.
- `bun run typecheck`: run TypeScript checks with `tsc --noEmit`.
- `bunx oxlint .` and `bunx oxfmt . --check`: optional lint/format validation using installed tools.

## Coding Style & Naming Conventions
Use TypeScript and keep modules small and single-purpose. Match the surrounding file style rather than reformatting unrelated code. Existing code uses:

- `camelCase` for variables/functions
- `PascalCase` for types/classes
- short route files named by endpoint, for example `routes/v1/deni.ts`

Prefer explicit return types on exported functions and keep API error payloads consistent with current Hono handlers.

## Testing Guidelines
There is no automated test suite configured yet. At minimum, run `bun run typecheck` before opening a PR. For endpoint changes, verify manually with `curl` or a REST client against `/health`, `/v1/agent/chat/completions`, or the affected `/v1/deni/*` route.

If you add tests, place them near the feature or under a top-level `tests/` directory and use descriptive names such as `deni-usage.test.ts`.

## Commit & Pull Request Guidelines
Use Conventional Commits. Current history favors prefixes like `fix:` and `feat:`; keep subjects short and lowercase, for example `fix: handle null Deni billing plan ids`.

PRs should include:

- a brief description of the change and user-facing impact
- linked issue or context when applicable
- manual verification steps
- sample requests/responses for API behavior changes

## Security & Configuration Tips
Do not commit real API keys or database URLs. Keep secrets in `.env` or deployment-managed env vars such as `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, and `DENI_DATABASE_URL`.
