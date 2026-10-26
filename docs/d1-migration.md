# Moving the database from Postgres to Cloudflare D1

The app keeps running on Docker/Dokploy. Only the database moves.

```
App server + worker  --HTTPS, bearer token-->  d1-proxy Worker  --binding-->  D1
```

D1 can only be bound inside a Worker. Calling its REST API directly from the server would
share Cloudflare's account-wide limit of 1,200 requests per 5 minutes (about 4 queries per
second), which this app exceeds with job polling and per-message writes. The `d1-proxy`
Worker has no such limit and also provides `/batch`, which D1 runs as one transaction.

Local development and `pnpm test:core` need no Cloudflare account: with `D1_PROXY_URL`
unset the app uses a SQLite file (`.deni/local.sqlite`), which is the same dialect as D1
and is migrated automatically from `db/migrations`.

## What changed in the code

| Postgres | D1 |
|---|---|
| `jsonb`, `timestamptz` | JSON text and epoch-millisecond integers (`db/columns.ts`) |
| `SELECT ... FOR UPDATE` on the user document | `version` column compare-and-swap in `mutateStore` (re-reads and re-runs the callback on conflict) |
| `pg_advisory_xact_lock` for job events | sequence allocated inside the `INSERT`, unique index, retry |
| row lock in `claimJob` | conditional `UPDATE` repeating the observed state in `WHERE` |
| multi-statement transactions | `db.batch()` (one D1 transaction) with a version guard |
| `jsonb_array_elements`, `->>` | `json_each`, `json_extract` |

Interactive transactions (`db.transaction`, `BEGIN`) are refused by the executor and the
Worker, because they cannot span separate HTTP calls.

`mutateStore` callbacks can run more than once when two processes race. Keep them free of
side effects that are unsafe to repeat.

## One-time setup

1. Create the database and note its id:
   `pnpm exec wrangler d1 create deni-run`
2. Put the id in `d1-proxy/wrangler.jsonc` (`database_id`).
3. Create the schema: `pnpm db:migrate`
4. Set the shared secret and deploy:
   `pnpm exec wrangler secret put PROXY_TOKEN --config d1-proxy/wrangler.jsonc`
   `pnpm d1:deploy`
5. Give the Worker a URL (custom domain such as `d1.deniai.app`, or a route). `workers_dev`
   is off on purpose; the endpoint should only be reachable with the token.
6. Check it: `curl https://d1.deniai.app/health` returns `{"ok":true}`.

## Rehearsal (no downtime)

Copy production into D1 while the app is still running on Postgres. Re-runs converge, so
this can be repeated.

```
SOURCE_DATABASE_URL=postgres://...  D1_PROXY_URL=https://d1.deniai.app  D1_PROXY_TOKEN=... \
  pnpm d1:copy-from-postgres -- --dry-run     # sizes only, writes nothing
  pnpm d1:copy-from-postgres                  # real copy, then verifies
```

The copy verifies row counts for every table and compares every JSON document. It fails
on any row over 1.8 MB (D1's limit is 2 MB per row); trim such rows in Postgres first.

## Cutover (a few minutes of maintenance)

1. Stop the app and the worker (so nothing writes to Postgres).
2. Final copy, emptying the target first so rows deleted since the rehearsal disappear:
   `pnpm d1:copy-from-postgres -- --reset --yes`
3. Set `D1_PROXY_URL` and `D1_PROXY_TOKEN` in the app environment and remove
   `DATABASE_URL`, `POSTGRES_*`.
4. Deploy the new image. `/api/health` should return `{"ok":true}`.
5. Sign in, open a thread, start a task, and check that a routine fires.

## Rollback

Keep the Postgres container and its volume until you are satisfied. To roll back, redeploy
the previous image with `DATABASE_URL`. Anything written to D1 after the cutover is not
copied back.

## Notes

- Columns declared `timestamp without time zone` (the auth tables) are read as UTC
  wall-clock time, exactly as the previous Drizzle driver read them. A Postgres server
  whose time zone is not UTC would have stored `now()` defaults in local time, and those
  rows carry the same offset after the copy.
- `rate_limits` is not copied; it is a short-lived counter.
- D1 limits worth knowing: 2 MB per row, 10 GB per database, 100 bound parameters per
  statement. The Worker caps a batch at 100 statements.
- Each query is now an HTTP round trip to Cloudflare. Pages that issue many sequential
  queries are slower than against a Postgres container on the same host.
