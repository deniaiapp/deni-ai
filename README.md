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

## Deployment

Production runs on Dokploy from the `Dockerfile` (Build Type: Dockerfile,
port 3000, domain support.deniai.app). No environment variables are needed.

`pnpm run build` produces a Node server in `.output/`. It still imports a few
packages at runtime, so start it next to `node_modules`:

```bash
pnpm start
```

The server listens on `PORT` (default 3000).
