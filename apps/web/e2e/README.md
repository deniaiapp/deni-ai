# End-to-end tests

Playwright tests that drive a production build of `apps/web` in Chromium.

| Spec                   | Covers                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `public-pages.spec.ts` | `/home`, `/ja`, the changelog, permanent redirects of retired pages, `robots.txt`, the sitemap  |
| `auth.spec.ts`         | Redirect to sign-in, guest sign-in, email + password sign-up, logout, sign-in, a wrong password |
| `chat.spec.ts`         | Streamed answers that survive a reload, a continued conversation from the sidebar, Stop         |

## Run

The tests need an **empty, throwaway** Postgres database; global setup applies
`packages/db/migrations` to it, and every test creates its own accounts.

```bash
createdb deni_ai_e2e
pnpm --filter @deniai/web exec playwright install chromium   # once
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/deni_ai_e2e pnpm test:e2e
```

`pnpm test:e2e` (root or `apps/web`) builds the app with the test environment and
starts it on `http://127.0.0.1:3100`. Set `E2E_SKIP_BUILD=1` to reuse the last
test build in `.output` while only the specs change (a normal `pnpm build`
overwrites it with other public URLs). Useful flags: `--ui`, `--headed`,
`--repeat-each=3` (flakiness), `-g "<test name>"`.

CI runs the same command in the `e2e` job of `.github/workflows/ci.yml` against a
`postgres:18` service and uploads the report and traces when a test fails.

## How it is set up

- `playwright.config.ts` starts two servers: `e2e/mock-deni-api.ts` and the app.
- `e2e/env.ts` is the app's environment. It sets every `NEXT_PUBLIC_*` value and
  blanks the keys of external services, so a local `.env` or `.env.local`
  (possibly with production values) cannot leak into the test build.
- **AI answers** come from `e2e/mock-deni-api.ts`, an OpenAI-compatible stand-in
  for the Deni AI API (`DENI_API_BASE_URL`). It answers `Mock reply: <last user
  text>`, streams for about ten seconds when the message contains `[slow]`, and
  returns an empty memory result for structured-output calls. Only models routed
  through the Deni AI API (the default GPT-6 Luna) work; OpenRouter models are
  unavailable.
- **Email** is not configured, so sign-up needs no verification link, and Turnstile
  is off.
- **Client addresses**: the server trusts `x-e2e-client-ip` (`CLIENT_IP_HEADER`) and
  `e2e/fixtures.ts` sends a random address per test, so rate limits and sign-up
  caps apply per test, not to one bucket shared by parallel tests. Import `test`
  and `expect` from `./fixtures`, not from `@playwright/test`.
- `e2e/helpers.ts` waits for React to hydrate an element before using it; before
  that, a click submits forms natively.
