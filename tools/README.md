# tools

Internal scripts for maintainers. Run from the **repository root** with pnpm. Package scripts explicitly load `.env.local` when present; production maintenance uses `.env.production`.

| Script                         | npm script                                 | Purpose                                                                                                         |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `codename-generator.ts`        | `pnpm run tools:codename`                  | Generate Deni AI version codenames                                                                              |
| `commit.ts`                    | `pnpm run tools:commit`                    | Conventional commit messages via OpenRouter                                                                     |
| `grant-card-flash-offer.ts`    | `pnpm run tools:grant-card-flash-offer`    | One-off flash offer for card-verified users (dry run unless `--apply`)                                          |
| `purge-anonymous.ts`           | `pnpm run tools:purge-anonymous`           | Purge anonymous users and their stored files (uses `.env.production`)                                           |
| `migrate-uploadthing-to-r2.ts` | `pnpm run tools:migrate-uploadthing-to-r2` | Copy UploadThing files to R2 (dry run unless `--apply`; uses `.env.production`)                                 |
| `audit-uploadthing-storage.ts` | `pnpm run tools:audit-uploadthing-storage` | Read-only breakdown of the UploadThing files by what the database still references                              |
| `migrate-legacy-chat-files.ts` | `pnpm run tools:migrate-legacy-chat-files` | Move files old chats reference by public UploadThing URLs to R2 with attachment rows (dry run unless `--apply`) |
| `stripe-portal-setup.ts`       | `pnpm run tools:stripe-portal`             | Stripe Customer Portal configuration                                                                            |
| `copy-database.ts`             | `pnpm exec tsx tools/copy-database.ts`     | Copy a whole database to an empty one and compare row counts (dry run unless `--apply`; needs Docker)           |

## Commit helper

Requires `OPENROUTER_API_KEY`. Generates a conventional commit message from the staged (or selected) diff. Creates a commit only when `--commit` is passed.

```sh
pnpm run tools:commit --it
pnpm run tools:commit --check
pnpm run tools:commit --all
pnpm run tools:commit --all --commit
pnpm run tools:commit --all --generate-description --commit
pnpm run tools:commit --all --description "Explain the checkout flow changes" --commit
```

- `--it` → `--all --generate-description --commit`
- `--check` → `--all --generate-description`
- `--description` supplies the commit body yourself

## Codename generator

```sh
pnpm run tools:codename
```

## Purge anonymous users

Production maintenance. Loads `.env.production` via the package script. Prefer reviewing the script before running against live data. Deleting a guest also deletes its stored attachment files (needs the `R2_*` settings; without them it deletes no users when the guests to purge have stored files, since nothing would record those files afterwards); files that could not be deleted are listed and the script exits with status 1.

```sh
pnpm run tools:purge-anonymous
```

## Copy UploadThing files to R2

Production maintenance, for the move from UploadThing to R2 (see SETUP.md, "Attachment storage move from UploadThing to R2", for the rollout order). Loads `.env.production`; needs `DATABASE_URL`, `UPLOADTHING_TOKEN` and the `R2_*` settings. Copies every ready attachment and ready, unexpired data export whose file is still in UploadThing to R2 under the same storage key, keeping the content type and name UploadThing served it with. The database is only read, and nothing is deleted. Dry run by default: it reports how many files are already in R2 and how many are left to copy. A file already in R2 is skipped, so it can be rerun; files that fail to copy are listed and the script exits with status 1. For another environment, run `pnpm exec tsx --env-file=.env.local tools/migrate-uploadthing-to-r2.ts`.

```sh
pnpm run tools:migrate-uploadthing-to-r2
pnpm run tools:migrate-uploadthing-to-r2 --apply
```

## Audit UploadThing storage

Production maintenance, read only: run it before deleting the UploadThing app's files (SETUP.md, "Attachment storage move from UploadThing to R2", step 6). Loads `.env.production`; needs `DATABASE_URL` and `UPLOADTHING_TOKEN`, and checks the files the copy tool covers in R2 when the `R2_*` settings are set. Lists every UploadThing file and reports counts and sizes by UploadThing status, by what in the database references it (ready attachments and current data exports, which the copy tool covers; pending, deleting or stale rows; public URLs in saved chats or model comparisons from before storage became private; retired project files; profile images; nothing), and the files the copy tool skips by upload month. Files referenced by public URLs still show in those chats: deleting them breaks the chats. `--csv=<path>` also writes one line per file with its category.

```sh
pnpm run tools:audit-uploadthing-storage
pnpm run tools:audit-uploadthing-storage --csv=uploadthing-audit.csv
```

## Move legacy chat files to R2

Production maintenance, for files uploaded before storage became private: saved chats still reference them by public UploadThing URLs in file parts, with no attachment row, so the R2 copy tool skips them (the audit above lists them as "Public URL in a saved chat"). Loads `.env.production`; needs `DATABASE_URL`, `UPLOADTHING_TOKEN` and the `R2_*` settings. For each such file it copies the file to R2 under its UploadThing key, records a ready attachment row for the chat's owner (counted against their storage quota) tied to the chat, and rewrites the chat's file parts to `/api/attachments/<id>`, keeping the chat's `updated_at`. Dry run by default: it reports the chats and files found, the storage each account gains, and files it leaves alone (referenced by several accounts or recorded for another, recorded but being deleted, gone from UploadThing, or only mentioned outside file parts). `--apply` migrates; `--limit=<n>` stops after n chats. Nothing is deleted. Rerun until a dry run reports nothing left to migrate; a rerun also rewrites old URLs a tab loaded before the run saved back. Failures are listed and the script exits with status 1.

```sh
pnpm run tools:migrate-legacy-chat-files
pnpm run tools:migrate-legacy-chat-files --apply --limit=50
pnpm run tools:migrate-legacy-chat-files --apply
```

## Stripe Customer Portal

Creates or updates the portal configuration that keeps plan and seat changes in the app (subscription updates disabled). Changes the Stripe account for the loaded secret key; `--check` is read-only. See SETUP.md (Customer Portal).

```sh
pnpm run tools:stripe-portal
pnpm run tools:stripe-portal --check
```

## Copy a database

Moves a database to another Postgres server, for example from Neon to a Postgres service on the Dokploy host. The env file passed with `--env` supplies `DATABASE_URL` (source) and `TARGET_DATABASE_URL` (target, which must be empty and run the same or a newer major version). pg_dump and pg_restore run in the `postgres:<major>` Docker image of the source server, so Docker must be running. The dry run only connects and reports versions and table counts. `--apply` copies every schema, including drizzle's migration history, in one transaction, then compares exact row counts table by table and exits with status 1 on any difference. The dump stays in the OS temp directory as a backup; it holds user data, so delete it once the move is settled.

```sh
pnpm exec tsx tools/copy-database.ts --env=.env.canary
pnpm exec tsx tools/copy-database.ts --env=.env.canary --apply
```

For production: stop the app (and anything else that writes to the database) before `--apply`, switch `DATABASE_URL` to the new server once the counts match, then start the app again. Keep the old database for a while in case you need to switch back, and set up scheduled backups of the new one to storage outside that host.
