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

## Stripe Customer Portal

Creates or updates the portal configuration that keeps plan and seat changes in the app (subscription updates disabled). Changes the Stripe account for the loaded secret key; `--check` is read-only. See SETUP.md (Customer Portal).

```sh
pnpm run tools:stripe-portal
pnpm run tools:stripe-portal --check
```
