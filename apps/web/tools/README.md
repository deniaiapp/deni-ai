# tools

Internal scripts for maintainers. Run from the **repository root** with pnpm. Package scripts explicitly load `.env.local` when present.

| Script                   | npm script                     | Purpose                                     |
| ------------------------ | ------------------------------ | ------------------------------------------- |
| `codename-generator.ts`  | `pnpm run tools:codename`      | Generate Deni AI version codenames          |
| `commit.ts`              | `pnpm run tools:commit`        | Conventional commit messages via OpenRouter |
| `stripe-portal-setup.ts` | `pnpm run tools:stripe-portal` | Stripe Customer Portal configuration        |

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

## Stripe Customer Portal

Creates or updates the portal configuration that keeps plan and seat changes in the app (subscription updates disabled). Changes the Stripe account for the loaded secret key; `--check` is read-only. See SETUP.md (Customer Portal).

```sh
pnpm run tools:stripe-portal
pnpm run tools:stripe-portal --check
```
