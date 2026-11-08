# @deniai/auth

Better Auth for Deni AI: the server configuration as a factory, the React
client, the auth route paths, and API key generation and hashing.

| Export                      | What it is                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@deniai/auth/server`       | `createAuth(deps)` → the Better Auth instance (`Auth`). `deps` carries the database, public URL, email sender, OAuth/Turnstile settings and the app callbacks. |
| `@deniai/auth/client`       | `createDeniAuthClient({ baseURL })`: React client with the matching plugins (anonymous, 2FA, passkey, organization, OAuth provider, last login method).        |
| `@deniai/auth/paths`        | Auth route paths shared by the server config and the UI (`/auth/two-factor`, `/oauth/authorize`, `/oauth/consent`, `/account/security`).                       |
| `@deniai/auth/api-key`      | `generateApiKey()`, `hashApiKey()` (WebCrypto SHA-256 hex), `getKeyPrefix()`, `API_KEY_PREFIX`.                                                                |
| `@deniai/auth/api-key/node` | `hashApiKeySync()` (node:crypto, same digest) for the agent API's per-request key validation.                                                                  |
| `@deniai/auth/dedupe`       | Package names apps put in Vite `resolve.dedupe` (see below).                                                                                                   |

The package never imports an app. The web app's `src/lib/auth.ts` is the
composition root: it reads env, passes its Drizzle `db`, `sendEmail` (only when
Cloudflare Email Sending is configured) and implementations of `AuthAppHooks`
(sign-up email policy and limits, security activity, guest data transfer, team
billing and audit, account deletion). Templates come from `@deniai/emails`;
tables from `@deniai/db`. `pnpm --filter @deniai/web auth:generate` loads that
composition root and writes `packages/db/src/schema/auth-schema.ts`.

## One Better Auth instance

pnpm resolves Better Auth's optional peers (Vite, TanStack Start, Vitest, …) per
importer, so this package and the app get different copies of the same
version. App hooks throw `APIError`, which Better Auth recognizes with
`instanceof`, so apps must load a single copy: add `authDedupe` from
`@deniai/auth/dedupe` to `resolve.dedupe` in the Vite and Vitest configs.
Node consumers that only use `api-key/node` (the agent API) are unaffected.

Scripts: `typecheck`, `lint`, `format`, `format:check`, `test` (vitest).
