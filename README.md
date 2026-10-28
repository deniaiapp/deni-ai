# Deni AI

> **AI Chatbot for Everyone** — access modern AI models in one place

Deni AI is a multi-model AI chat app for people who want strong model choice without juggling many separate subscriptions. It supports OpenAI, Anthropic, Google, xAI, and more through OpenRouter.

**Live app:** [https://deniai.app](https://deniai.app)

## Features

- **Multi-model chat** — switch between OpenAI, Claude, Gemini, xAI, and other routed models
- **Model comparison (Pro / Max)** — open Compare models from Chat Home to chat with two different models and stream their answers side by side (stacked on mobile). The shared text-only Composer sends each follow-up to both models with their own separate conversation histories and explicitly opts into a compact layout without empty addon panels. The regular chat Composer retains its original header spacing and focus-expansion behavior. Introductory copy appears only before the conversation starts; the compact header keeps model names and save actions accessible. Comparison reuses the regular Composer's searchable, provider-grouped model picker, including model descriptions and usage badges. Model choices stay fixed during a conversation; New comparison clears it and unlocks the pickers. Team plans and lifetime Pro are included. Each answer consumes normal existing quota, including normal Max Mode overage when enabled; limits and prices are unchanged. Comparison does not create regular chat-history entries. Save comparison persists both models, their names, and their full separate conversations in `model_comparisons`; Saved comparisons lists the current user's saved comparisons and reopens them at `/compare/[id]`. Follow-ups can be saved back to the same comparison. Each model has independent Generation settings for supported reasoning effort, Search (force a lookup), Deep Research, and supported Pro / Fast modes, plus an allowlist for the search and browse tools. Allowed web tools may run automatically; turning off Search alone does not forbid automatic lookups, while disabling the search tool does. Disabling that tool also disables forced Search and Deep Research. Settings apply to the next answer, stay locked during generation/saving, and are saved/restored with the comparison. Unsupported effort/modes are normalized for the selected model; unconfigured web tools are unavailable. Saved comparisons remain readable after a plan downgrade, while generation and saving require Pro / Max. Each entry in Saved comparisons has a Delete button that, after confirmation, permanently deletes that comparison (`chat.deleteComparison`, owner-scoped, available on every plan) and leaves it if it is open; chats saved with Continue this chat are separate chats and are kept. Delete all conversations also deletes saved comparisons, and the account data export includes their text. Clicking Continue this chat still saves only the selected model's full conversation without regenerating it; unsaved changes are discarded when leaving the page. Apply migrations `0052_legal_leech.sql` and `0053_previous_blindfold.sql` before using comparison storage and saved generation settings. Comparison does not expose interactive questionnaires or auto-save memories.
- **Chat history** — the sidebar includes all conversation summaries, including older pinned and filed chats; message bodies load separately. Retry instructions apply only to explicit regeneration requests. Async dropdown actions (chat pin/unpin and deletion, transcript exports, Max Mode and logout, team switching and member-role changes, and avatar/team-icon updates) keep the menu open during processing, show a loading indicator on the active action, and disable other menu actions until completion. Failed chat deletions leave the menu open for retry.
- **Tools** — web search (Exa) is available on every chat and used when current information is needed; each search call consumes a fixed amount of basic usage (Search mode forces a lookup). Page browse and agent-led interactive questionnaires for clarifications. Image and video generation are not supported; a saved message that contains a successful image or video result shows a single "no longer available" notice for each kind instead of the result (failed results are hidden)
- **Intelligent UI** — chat answers can embed native, interactive components where they help more than prose: charts (bar, line, area, pie, donut) with hover details and a data-table view, stat tiles, checklists (ticks are kept per browser), action buttons and tappable cards that send a follow-up, live calculators, timelines, side-by-side comparisons, sortable tables, tabs, forms, and quizzes. Models write them as fenced ` ```ui ` JSON blocks (`src/lib/intelligent-ui/`); blocks that fail validation fall back to a plain code block. Settings → Appearance → Layout and visuals switches between Rich (default) and Simple, which keeps answers text-first unless a visual is requested; the choice is stored in the browser and applies to the next answer. Comparisons do not use Intelligent UI
- **Memory & projects** — personalization memories and project-scoped context; projects can be shared with a team
- **Teams** — organizations, seats, shared Pro or Max access (per-seat billing), and team projects
- **Billing** — Stripe subscriptions (personal and team) plus Max Mode metered overage; scheduled cancellations keep the current paid plan through the period end, with an animated cancellation receipt. Enabling Max Mode requires an active subscription; cancellation, trial, and past-due states are not eligible. Optional self-host disable via `NEXT_PUBLIC_BILLING_DISABLED`
- **Usage reset credits** — admins can grant credits to all users, a plan, or one user; each credit clears that user's basic and premium usage from Settings → Billing
- **Auth** — Google / GitHub sign-in, magic link, anonymous guest, passkeys, and 2FA (better-auth)
- **Data export** — Settings → Account builds a JSON copy of the account in the background and keeps it as a private download, signed for its owner only, for 7 days (built in the request when file storage is not configured; see [SETUP.md](SETUP.md))
- **History APIs** — security and team audit logs use `{ createdAt, id }` cursors to preserve events with identical timestamps. Pass `nextCursor` unchanged when requesting another page.
- **Ads** — Chat Home shows a Deni AI Ads placement below the composer only for confirmed Free users (including anonymous guests). Paid users and users whose plan is still loading do not request ads.
- **i18n** — English and Japanese (`use-intl`; public pages under `/ja/*`)
- **Public guides & blog** — original articles on model choice, verification, and practical AI use, available without an account
- **PWA** — installable progressive web app assets and service worker

## Tech stack

| Area      | Choice                                                                  |
| --------- | ----------------------------------------------------------------------- |
| Framework | TanStack Start (TanStack Router, Vite, Nitro, React 19, React Compiler) |
| Language  | TypeScript (strict)                                                     |
| Runtime   | Node.js 26+ (pnpm 12.8.1)                                               |
| UI        | Tailwind CSS v4, shadcn/ui (Base UI)                                    |
| API       | tRPC + TanStack Query                                                   |
| DB        | PostgreSQL (Neon recommended) + Drizzle ORM                             |
| Auth      | better-auth                                                             |
| Billing   | Stripe                                                                  |
| AI        | Vercel AI SDK + provider SDKs / OpenRouter                              |

## Quick start

```bash
# Clone
git clone https://github.com/deniaiapp/app.git
cd deni-ai

# Install
pnpm install

# Configure (copy example and fill the core values plus any optional features)
cp .env.example .env.local

# Database
pnpm run db:migrate:dev   # local: uses .env.local
# or: pnpm run db:push

# Dev server → http://localhost:3000
pnpm dev
```

Full prerequisites, environment variables, Stripe, OAuth, and deployment steps: **[SETUP.md](SETUP.md)**.

**Self-hosting database:** we recommend [Neon](https://neon.tech). The app is already wired for Neon serverless Postgres.

## Documentation

| Doc                                      | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| [SETUP.md](SETUP.md)                     | Env vars, database, Stripe, Docker / Dokploy, scripts |
| [CONTRIBUTING.md](CONTRIBUTING.md)       | Contributor workflow and coding standards             |
| [SECURITY.md](SECURITY.md)               | Vulnerability reporting                               |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community guidelines                                  |
| [AGENTS.md](AGENTS.md)                   | Agent / AI-assisted development guide                 |

## Project layout (high level)

```
src/
  routes/        # TanStack file routes (marketing, chat, settings, API endpoints)
  server/http/   # HTTP handler logic behind the API routes
  components/    # UI, chat, auth, billing, team
  db/schema/     # Drizzle schemas
  lib/           # Auth, billing, chat, tools, providers
  server/api/    # tRPC routers
messages/        # en.json, ja.json
migrations/      # Drizzle SQL migrations
packages/        # Workspace packages (e.g. disposable-email-domains)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Day-to-day development targets the **`canary`** branch; **`master`** is the release/promotion target.

```bash
pnpm run lint
pnpm run format
pnpm run typecheck
pnpm test
pnpm run build
```

## License

MIT License — see [LICENSE](LICENSE).

## Sponsors

If Deni AI is useful to you, consider supporting development on GitHub Sponsors:

[https://github.com/sponsors/raicdev](https://github.com/sponsors/raicdev)

Sponsorships help cover hosting, infrastructure, and ongoing maintenance so we can keep improving free and accessible AI chat.

## Support

For issues, questions, or suggestions, please open a GitHub [issue](https://github.com/deniaiapp/app/issues) or [discussion](https://github.com/deniaiapp/app/discussions).

Security vulnerabilities: report privately per [SECURITY.md](SECURITY.md) — do not use public issues.
