# Deni AI v8 percentage rollout on deniai.app

Instead of a separate beta host, `deniai.app` itself serves v8 to a share of
visitors and v7 to the rest. Visitors can switch version from the account menu, the
share can go up or down at any time, and `V8_PERCENT=0` sends everyone back to v7
within seconds. Once v8 serves everyone without trouble, `docs/v8-takeover.md`
replaces v7 for good.

```
visitor ─▶ deniai.app ─▶ Cloudflare Worker (services/rollout-router)
                           ├─ v7: the request as is ─▶ Caddy ─▶ minidock app deni-ai (v7)
                           └─ v8: v8-origin.deniai.app ─▶ Caddy ─▶ minidock app deni-ai-beta (v8)
```

Caddy on the minidock server routes by host name only, so the Worker picks the
version by the host name it forwards to. Both apps keep sharing the production
database (`deni-ai-db`), the R2 bucket and `BETTER_AUTH_SECRET`, as during the
private beta, so sign-in and data follow a visitor between versions.

## How visitors are assigned

The Worker keeps a browser on one version with the `deni_variant` cookie (90 days):

| Cookie                 | Version                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `b0` … `b99` (bucket)  | v8 while the bucket is below `V8_PERCENT`, else v7                            |
| `v7` / `v8` (choice)   | the version the visitor picked in the account menu, whatever the percentage   |
| none                   | a page view draws a bucket; API calls, bots and server requests get v7       |

- Raising `V8_PERCENT` moves only the next buckets to v8; lowering it moves the
  highest ones back. Nobody else changes version.
- `V8_PERCENT=0` sends everyone to v7, choices included. Cookies are kept, so going
  back up restores who had v8.
- Assignment is per browser: one person can have v8 on a laptop and v7 on a phone.

Fixed routes, whatever the cookie:

| Path                 | Version | Why                                                                      |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| `/api/stripe/*`      | v7      | v7 processes Stripe webhooks; v8 has `STRIPE_WEBHOOK_ENABLED=false`      |
| `/api/cron/*`        | v7      | v7 runs the jobs; v8 has `CRON_ENABLED=false`                            |
| `/api/integrations/*`| v7      | Deni Run's usage reporting (server to server)                            |
| `/api/client/v1/*`   | v8      | the Deni AI Desktop API exists only in v8                                |

The Worker also answers:

- `/__rollout/v7?return=<path>` and `/__rollout/v8?return=<path>`: store the choice
  and go back to the page (the account menu links, behind `ROLLOUT_SWITCH_ENABLED`).
  Each switch is logged as `{"event":"rollout_switch","to":"v7",...}`.
- `/__rollout/auto`: forget the choice and draw a bucket again.
- `/__rollout`: the current state as JSON (`variant`, `cookie`, `percent`), for support.

Requests to v8 carry the visitor's address in `x-real-ip`, which Cloudflare turns
into `CF-Connecting-IP` for same-zone subrequests, and `x-forwarded-host: deniai.app`.
A redirect v8 builds from its own host name is rewritten back to `deniai.app`.

## Setup

1. **v7 code**: deploy the `deni-ai` repository with `ROLLOUT_SWITCH_ENABLED` support
   (`src/lib/rollout.ts`, the "Try the new Deni AI" menu item) to `master`, so the
   `deni-ai` app has it. Leave the variable unset for now.
2. **v8 host name**: create a proxied DNS record `v8-origin.deniai.app` for the
   minidock server, and add it to the `deni-ai-beta` app's Domains tab with HTTPS on.
3. **v8 configuration** (`deni-ai-beta` Environment and Build-time Arguments):

   | Variable                                                    | Value                                                                    |
   | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
   | `NEXT_PUBLIC_BETTER_AUTH_URL` (build argument), `BETTER_AUTH_URL` | `https://deniai.app`                                               |
   | `BETA_ACCESS_REQUIRED`, `BETA_ACCESS_PAID_PLANS`            | Unset                                                                    |
   | `ROLLOUT_SWITCH_ENABLED`                                    | `true`                                                                   |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                  | v7's GitHub OAuth App (callback on `deniai.app`)                         |
   | `DENI_RUN_OAUTH_CLIENT_ID`, `DENI_RUN_SERVICE_SECRET`       | v7's values (Deni Run's consent screen can be served by v8)              |
   | `CLIENT_IP_HEADER`                                          | `cf-connecting-ip`                                                       |
   | `CRON_ENABLED`, `STRIPE_WEBHOOK_ENABLED`                    | `false` (unchanged: v7 keeps both)                                       |
   | `RUN_ENABLED`                                               | `false` (unchanged) until Run's background work runs (in-process or worker) |
   | `NOINDEX`                                                   | `1` (unchanged: crawlers only ever get v7, and it keeps `v8-origin` out) |
   | `PASSKEY_RP_ID`                                             | `deniai.app` (unchanged)                                                 |

   Deploy it. From now on `v8-origin.deniai.app` only works behind the Worker: its
   auth URL is `deniai.app`, so sign-in there directly is refused.
4. **Retire `beta.deniai.app`**: remove it from the `deni-ai-beta` app's Domains and
   add a Cloudflare redirect rule from `beta.deniai.app/*` to
   `https://deniai.app/__rollout/v8?return=/`, so beta testers keep v8. They sign in
   once more on `deniai.app` (cookies are per host).
5. **Deploy the Worker at 0%**: check `V8_ORIGIN` and `V8_PERCENT: "0"` in
   `services/rollout-router/wrangler.jsonc`, then
   `pnpm --filter @deniai/rollout-router run deploy` (Wrangler asks for a Cloudflare
   login once). Nothing changes for visitors.
6. **Check by hand**:
   - `https://deniai.app/__rollout` answers `{"variant":"v7",...,"percent":0}`.
   - With the percentage still at 0, the switch has no effect; deploy with
     `V8_PERCENT: "1"`, open `https://deniai.app/__rollout/v8`, and confirm v8
     (the account menu has "Switch to the previous version"), that you are still
     signed in, a chat streams, and `/__rollout/v7` brings v7 back.
   - Set `ROLLOUT_SWITCH_ENABLED=true` on the `deni-ai` app (v7) and deploy it, so v7
     shows "Try the new Deni AI".

## Running the rollout

Change `V8_PERCENT` in `wrangler.jsonc` and deploy the Worker (the change is then in
git), for example 5 → 20 → 50 → 100, a few days each. Watch at every step:

- **Errors**: Sentry for both apps, Workers Logs for the Worker.
- **Switches back**: Workers Logs, `rollout_switch` events with `"to":"v7"`, against
  the number of v8 visitors.
- **Use per version** (production database, read only). v8 writes `chat_messages`;
  a chat v7 last wrote has `message_count` NULL (trigger `0079`):

  ```sql
  -- people who sent a message on v8 in the last 7 days
  select count(distinct c.user_id) from chat_messages m join chats c on c.id = m.chat_id
  where m.role = 'user' and m.created_at > now() - interval '7 days';
  -- people whose chats v7 last changed in the last 7 days
  select count(distinct user_id) from chats
  where updated_at > now() - interval '7 days' and message_count is null;
  ```

- **Feedback**: v8's account menu has "Send feedback", which opens the help center
  form with `from=v8`; those messages start with `[Deni AI v8 · 8.0 (<release date>)]`.

**Going back**: deploy the Worker with `V8_PERCENT: "0"`. Everyone is on v7 within
seconds; nothing in the database needs undoing (every v8 migration is additive and
v8 keeps writing `chats.messages`). What v7 cannot show: per-chat and preferred
models, and Run data if Run was on.

**Finishing**: at 100% and stable, follow `docs/v8-takeover.md`, which switches the
`deni-ai` app to v8 and removes the Worker.

## Limits while deniai.app is split

- **Deni AI Desktop sign-in** needs the `chat` scope, which only v8 knows, but token
  requests carry no cookie and reach v7. Desktop sign-in works after the takeover.
- **Service workers**: v8 uses its own cache names, so each version's worker deletes
  the other's caches when a visitor switches; the first page after a switch may load
  without the offline cache.
- **Cloudflare cache**: v7 and v8 responses come from different host names, so
  their cache keys never mix, even with HTML caching on.
- **Two-factor reminder**: password-only accounts see v8's reminder only on v8.
