# tools

Internal scripts for maintainers. Run from the **repository root** with pnpm. Package scripts explicitly load `.env.local` when present; production maintenance uses `.env.production`.

| Script                           | npm script                                   | Purpose                                                                                              |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `codename-generator.ts`          | `pnpm run tools:codename`                    | Generate Deni AI version codenames                                                                   |
| `commit.ts`                      | `pnpm run tools:commit`                      | Conventional commit messages via OpenRouter                                                          |
| `grant-card-flash-offer.ts`      | `pnpm run tools:grant-card-flash-offer`      | One-off flash offer for card-verified users (dry run unless `--apply`)                               |
| `purge-anonymous.ts`             | `pnpm run tools:purge-anonymous`             | Purge anonymous users and their stored files (uses `.env.production`)                                |
| `migrate-private-attachments.ts` | `pnpm run tools:migrate-private-attachments` | Move pre-private-storage uploads to private files (dry run unless `--apply`; uses `.env.production`) |
| `stripe-portal-setup.ts`         | `pnpm run tools:stripe-portal`               | Stripe Customer Portal configuration                                                                 |

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

Production maintenance. Loads `.env.production` via the package script. Prefer reviewing the script before running against live data. Deleting a guest also deletes its stored attachment files (needs `UPLOADTHING_TOKEN`; without a valid token it deletes no users when the guests to purge have stored files, since nothing would record those files afterwards); files that could not be deleted are listed and the script exits with status 1.

```sh
pnpm run tools:purge-anonymous
```

## Migrate attachments to private storage

Production maintenance, run once after deploying private attachment storage (see SETUP.md, "Attachment storage", for the rollout order). Loads `.env.production`; needs `DATABASE_URL` and `UPLOADTHING_TOKEN`. Finds chats whose saved messages reference public UploadThing URLs of this app (`https://<appId>.ufs.sh/f/<key>`), records an `attachment` row for each file (owned by the chat's owner, tied to the chat, sized from the UploadThing file list), rewrites those URLs to `/api/attachments/<id>`, and makes the files private. Nothing is deleted. Dry run by default: it reports the chats, files and storage each account gains against its quota. Resumable: rerun until it reports nothing left. A file referenced by more than one account is left public and listed. A file UploadThing no longer lists, or whose row was deleted or is being deleted since the scan, is not recorded (again) and is listed; its chats keep the public URL. A tab opened before the run keeps working: the chat server reads and saves the user's migrated files by their app URLs. `--limit=<n>` migrates at most n chats per run. For another environment, run `pnpm exec tsx --env-file=.env.local tools/migrate-private-attachments.ts`.

```sh
pnpm run tools:migrate-private-attachments
pnpm run tools:migrate-private-attachments --apply
pnpm run tools:migrate-private-attachments --apply --limit=100
```

## Stripe Customer Portal

Creates or updates the portal configuration that keeps plan and seat changes in the app (subscription updates disabled). Changes the Stripe account for the loaded secret key; `--check` is read-only. See SETUP.md (Customer Portal).

```sh
pnpm run tools:stripe-portal
pnpm run tools:stripe-portal --check
```
