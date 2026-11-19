# @deniai/support

The Deni AI help center (support.deniai.app), built with
[Fumadocs](https://fumadocs.dev) on TanStack Start.

## Development

This app is `@deniai/support` in the deni-ai monorepo. Install from the
monorepo root, then run commands here (or with `pnpm --filter @deniai/support`):

```bash
pnpm install
pnpm dev
```

```bash
pnpm run types:check
pnpm run lint
pnpm run build
```

## Writing articles

Articles live in `content/docs/`. Each article has an English file and a
Japanese file next to it:

```
content/docs/flixa/external-tools.mdx     -> /en/flixa/external-tools
content/docs/flixa/external-tools.ja.mdx  -> /ja/flixa/external-tools
```

Sidebar order and folder titles come from `meta.json` (use `meta.ja.json` for a
Japanese title that differs). `/` redirects to `/en` or `/ja` based on
`Accept-Language`.

## Support features

Every page has a "Get help" widget (bottom right) where an AI assistant
(Claude Haiku 5.5) answers questions by searching and reading the help center
articles. The contact and feedback forms, which email the team, also live in
the widget: its "Contact support" and "Send feedback" buttons open them, and the
assistant can draft either message as a card in the chat that the user reviews,
edits, and sends. Messages sent from the widget carry the conversation.
Links to `/en/contact` and `/en/feedback` (and the `/ja/` versions, with an
optional `?category=` on contact) open the forms in the widget; visiting those
URLs redirects to the help center home with the form open. Each article also
ends with a "Was this page helpful?" prompt.

With a database configured, widget conversations are saved so the team can
answer contact and feedback messages:

- Each chat exchange and each message sent to the team is stored in the
  `support` schema. The browser keeps the conversation's credential
  (`<id>.<HMAC token>`) in `localStorage` and restores the chat on the next visit.
- The team works from the admin inbox at `/admin` (password:
  `SUPPORT_ADMIN_TOKEN`), which lists conversations with a contact or feedback
  message. Notification emails to the team link to the conversation there.
- A reply appears in the visitor's chat (with an unread dot on the "Get help"
  button) and is emailed to the address they gave, with a link that opens the
  conversation in the widget on any device. The visitor answers with the reply's
  "Reply" button, which reopens the conversation in the inbox.
- "New chat" starts a new conversation; earlier ones stay reachable from the
  reply emails.

They are configured with runtime environment variables, listed in
`.env.example`. For local development, copy it to `.env.local`. All are
optional: without `ANTHROPIC_API_KEY` the widget shows only the contact and
feedback buttons; without the Cloudflare email credentials the forms say they are
unavailable; without both Turnstile keys nothing is challenged; without
`DATABASE_URL` and `SUPPORT_SECRET` nothing is saved and replies go by email
only. Requests are also rate limited per IP in memory.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | AI support chat |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Contact and feedback email (Email Sending: Edit) |
| `SUPPORT_EMAIL_TO`, `SUPPORT_EMAIL_FROM` | Recipient and sender (default `contact@deniai.app`, `Deni AI Support <noreply@deniai.app>`) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile for the chat and forms |
| `DATABASE_URL` | Postgres (the Deni AI database) for saved conversations; the pooled URL works |
| `SUPPORT_SECRET` | Long random string that signs conversation links and admin sessions; changing it detaches every saved conversation from its browser |
| `SUPPORT_ADMIN_TOKEN` | Password for the admin inbox at `/admin` |

## Database

The tables live in the `support` schema of the Deni AI database
(`src/server/db/schema.ts`); deni-ai and Flixa leave that schema alone. After
changing the schema, generate a migration and review the SQL in `migrations/`:

```bash
pnpm run db:generate
```

Apply migrations to the database in `DATABASE_URL` from `.env` (production) or
`.env.local` (development) before deploying code that needs them:

```bash
pnpm run db:migrate
```

```bash
pnpm run db:migrate:dev
```

## Deployment

Production runs on minidock as the `support` app, built from
`apps/support/Dockerfile` with the monorepo root as the build context (port 3000,
domain support.deniai.app). Set the support variables above as runtime
environment variables; no build arguments are needed. Schema changes: run
`pnpm run db:migrate` against the production database (`DATABASE_URL`) before
the deploy that needs them. The `support` schema keeps its own journal
(`support.__drizzle_migrations`), separate from the web app's migrations.

This directory is the help center's only source. It replaced the standalone
`deniaiapp/support` repository (imported with `git subtree` at `2c772d4`; its
later changes up to `392a20f` were ported here). To move the minidock `support`
app over, change only its source in the panel and press **Deploy**: repository
`deniaiapp/deni-ai`, branch `beta/v8` (`master` once v8 is promoted there),
build path `.`, Dockerfile `apps/support/Dockerfile`. The Environment, port 3000
and the domain stay as they are, and the database needs no migration (the
`support` schema is already at `0000`).

`pnpm run build` produces a Node server in `.output/`. It still imports a few
packages at runtime, so start it next to `node_modules`:

```bash
pnpm start
```

The server listens on `PORT` (default 3000).
