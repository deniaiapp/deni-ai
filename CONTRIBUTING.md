# Contributing

## Commit messages

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/) with an explicit scope and a body.

```
type(scope): short imperative summary

Explain why the change exists and what it does. The title is not enough.
```

One scope, or several joined with commas (no spaces):

```
feat(web): show usage meters on the upgrade page

Surface remaining tokens and computer minutes so people can decide
whether to upgrade before they hit a limit.
```

```
chore(web,api,db): align tenant queries with schema

Keep store reads, API handlers, and migrations on the same user-scoped
keys so account data does not leak across tenants.
```

### Title

- Imperative, present tense: `add`, `fix`, `skip` — not `added` or `adds`
- Whole header (`type(scope): subject`) is at most 72 characters
- No trailing period
- Do not shout in Title Case or ALL CAPS

### Scope (required)

Use one allowed scope, or several in the order they matter: `chore(web,api,db)`. Do not put spaces after commas.

| Scope | Use for |
| --- | --- |
| `web` | Pages, UI, client components |
| `api` | Route handlers |
| `db` | Schema and migrations |
| `auth` | Clerk and session gates |
| `billing` | Stripe, plans, usage limits |
| `agent` | Model, tools, scheduler, handoffs |
| `computer` | Browser, sandbox, workspace files |
| `docker` | Image, Compose, container entrypoint |
| `ci` | GitHub Actions, Husky, commitlint |
| `docs` | README and contributing |
| `deps` | Dependency bumps |
| `config` | Next config, env examples, tooling |

### Body (required)

Add a blank line after the title, then at least one sentence that is not a restatement of the title. Say why the change is needed. Wrap body lines at 100 characters.

Breaking changes use `feat(scope)!:` (or `BREAKING CHANGE:` in the footer) and still need a body.
