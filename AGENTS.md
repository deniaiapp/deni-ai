<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Commit messages

Follow `CONTRIBUTING.md`. Husky and commitlint reject commits that do not match.

Format:

```
type(scope): short imperative summary

Body that explains why, not only what. Required. At least 20 characters.
```

- Scope is required. Allowed: `web`, `api`, `db`, `auth`, `billing`, `agent`, `computer`, `docker`, `ci`, `docs`, `deps`, `config`.
- Header (including type, scope, and subject) is at most 72 characters. No trailing period. No Title Case or ALL CAPS. Wrap body lines at 100 characters.
- Example: `feat(web): show usage meters on the upgrade page`

