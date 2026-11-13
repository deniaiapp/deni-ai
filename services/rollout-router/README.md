# @deniai/rollout-router

Cloudflare Worker on `deniai.app/*` that sends a percentage of visitors to Deni AI
v8 and the rest to v7, keeps each browser on its version with the `deni_variant`
cookie, and serves the `/__rollout/*` switch links. Rules and operation:
`docs/v8-rollout.md`.

| File             | What                                                     |
| ---------------- | -------------------------------------------------------- |
| `src/router.ts`  | assignment, fixed routes, forwarding to v8, switch links |
| `src/index.ts`   | the Worker entry                                         |
| `wrangler.jsonc` | route, `V8_ORIGIN`, `V8_PERCENT`                         |

```bash
pnpm --filter @deniai/rollout-router test
pnpm --filter @deniai/rollout-router run deploy   # pnpm dlx wrangler deploy; Cloudflare login once
```

Change `V8_PERCENT` in `wrangler.jsonc` and deploy to move the rollout; `0` sends
everyone to v7.
