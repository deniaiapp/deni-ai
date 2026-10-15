# Framework

The app runs on TanStack Start (Vite and Nitro), not Next.js. Routes live in `app/routes/` and
`app/routeTree.gen.ts` is generated from them. The installed packages ship guides: read
`node_modules/@tanstack/react-start/skills/` and the skills it links to before changing routes,
server functions, or middleware.

UI strings are English source text passed to `useExtracted()` (components, from `@/i18n/react`),
`getExtracted()` (server code, from `@/i18n/server`), or `headTranslator()` (route `head`). They are
looked up in `messages/*.po` with use-intl. `pnpm dev`, `pnpm build`, and `pnpm messages:extract`
add new strings to the catalogs; translate the empty `msgstr` entries in `messages/ja.po`.

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

