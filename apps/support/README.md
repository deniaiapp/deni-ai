# deni-ai-support

The Deni AI help center (support.deniai.app), built with
[Fumadocs](https://fumadocs.dev) on TanStack Start.

## Development

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
articles. `/en/contact` and `/en/feedback` (and the `/ja/` versions) are forms
that email the team, and each article ends with a "Was this page helpful?"
prompt.

They are configured with runtime environment variables, listed in
`.env.example`. For local development, copy it to `.env.local`. All are
optional: without `ANTHROPIC_API_KEY` the widget shows only the contact and
feedback links; without the Cloudflare email credentials the forms say they are
unavailable; without both Turnstile keys nothing is challenged. Requests are
also rate limited per IP in memory.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | AI support chat |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Contact and feedback email (Email Sending: Edit) |
| `SUPPORT_EMAIL_TO`, `SUPPORT_EMAIL_FROM` | Recipient and sender (default `contact@deniai.app`, `Deni AI Support <noreply@deniai.app>`) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile for the chat and forms |

## Deployment

Production runs on Dokploy from the `Dockerfile` (Build Type: Dockerfile,
port 3000, domain support.deniai.app). Set the support variables above as
runtime environment variables; no build arguments are needed.

`pnpm run build` produces a Node server in `.output/`. It still imports a few
packages at runtime, so start it next to `node_modules`:

```bash
pnpm start
```

The server listens on `PORT` (default 3000).
