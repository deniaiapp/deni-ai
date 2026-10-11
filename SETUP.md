# Setup

This guide covers prerequisites, environment configuration, database setup, Docker / Dokploy, and deployment.

Source of truth for validated env vars: [`src/env.ts`](src/env.ts). Starter template: [`.env.example`](.env.example).

## Prerequisites

- [Node.js 22.18+](https://nodejs.org/) and [pnpm 12.8.1](https://pnpm.io/installation)
- [PostgreSQL](https://neon.tech/) (Neon serverless recommended for self-hosting)
- Core environment values (`DATABASE_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, and a 32-character `BETTER_AUTH_SECRET`)
- Optional API keys for AI providers (OpenRouter)
- Optional Google + GitHub OAuth credentials
- Optional Cloudflare Turnstile site + secret keys; set both to require a Turnstile check for email sign-up/sign-in, password reset, magic-link requests, and guest (anonymous) sign-in. Guests complete the check in a short dialog after choosing "Continue as Guest"; without both keys these flows run without a check.
- Optional Exa API key (web search)
- Optional Stripe secret and publishable keys (billing)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/deniaiapp/app.git
cd deni-ai
```

### 2. Install dependencies

```bash
npm install --global pnpm@12.8.1
pnpm install --frozen-lockfile
```

### 3. Set up environment variables

Copy the example file and fill in the core values plus any optional features:

```bash
cp .env.example .env
# For local overrides used by some scripts:
# cp .env.example .env.local
```

Minimum template (see `.env.example` for the full list):

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# App URL (must match the origin users open in the browser)
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# Authentication (BETTER_AUTH_SECRET must be exactly 32 characters)
BETTER_AUTH_SECRET=your-32-character-secret-here
# OAuth is optional; omit a provider pair to hide that sign-in button.
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# AI Providers (optional; missing keys hide dependent models/features)
OPENROUTER_API_KEY=your-openrouter-key


# Deni AI API (OpenAI-compatible). Key required to show OpenAI models.
DENI_API_KEY=
DENI_API_BASE_URL=https://api.deniai.app/v1

# Search (optional; missing key disables web search)
EXA_API_KEY=your-exa-api-key

# CAPTCHA (optional; omit both to disable Turnstile)
TURNSTILE_SECRET_KEY=your-turnstile-secret
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key

# Error monitoring, logs, and 10% sampled traces (optional; Sentry is disabled when empty and outside production)
# NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
# Readable stack traces: set at build time to upload source maps (org auth token)
# SENTRY_AUTH_TOKEN=sntrys_...
# SENTRY_ORG=your-org-slug
# SENTRY_PROJECT=your-project-slug

# Stripe (optional; missing Stripe keys disable billing)
STRIPE_SECRET_KEY=sk_test_your-stripe-key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your-stripe-publishable-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
# STRIPE_FLASH_OFFER_COUPON_ID=  # optional promo coupon
# STRIPE_PORTAL_CONFIGURATION_ID=  # portal config without plan changes (see Customer Portal)

# Email — Cloudflare Email Sending (optional — magic link / verification / org invites)
# Onboard deniai.app (or your domain) under Email Service → Email Sending first.
# API token needs Email Sending: Edit. Both vars required to enable email features.
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token

# Operator administration (optional; comma-separated server-side admin emails)
# ADMIN_EMAILS=you@example.com

# Rate limiting (optional — falls back to in-memory)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# File uploads (optional — without it attachments travel inline as base64 data URLs,
# limited to 512 KB per file, and nothing is stored or counted against a quota)
# Accepted attachments: JPEG/PNG/WebP/PDF up to 10 MB, and text files (.json, .csv, .md, .txt,
# source code, ...) up to 2 MB. Text files are inlined into the prompt.
# Files are stored private: see "Attachment storage" in the notes below for the required
# UploadThing dashboard settings.
UPLOADTHING_TOKEN=

# Client IP behind proxies (optional; see "Client IP behind proxies" below)
CLIENT_IP_HEADER=
TRUSTED_PROXY_HOPS=

# Optional: hide billing UI / disable paid flows in the client
NEXT_PUBLIC_BILLING_DISABLED=

```

Notes:

- Max Mode reports are persisted in `max_mode_meter_event` before Stripe delivery. Apply the generated queue and usage-reservation migrations before deploying, set `CRON_SECRET` to a random value of at least 32 characters, and schedule authenticated `GET /api/cron/max-mode-meter-events` calls every minute (`Authorization: Bearer <CRON_SECRET>`). The route recovers up to five interrupted usage reservations and sends up to five due meter events per call; increase scheduler frequency/concurrency if the backlog grows. Delivery retains the original timestamp, identifier, and idempotency key, with exponential retries. Because Stripe deduplicates identifiers for only 24 hours, events still uncertain after 23 hours from their first meter request are retained with `requires_review = true` for manual Stripe reconciliation rather than risking duplicate charges. The retry endpoint returns 503 while settlement/delivery failures or review items exist: alert on this and on an increasing pending backlog. Do not delete pending/review rows or automatically reset them; reconcile Stripe's request logs before resolving review items. Monitor Stripe's asynchronous meter error events as described in [Stripe's usage reporting guide](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api). Account deletion does not remove queued charges.
- Subscription deletion/ended-state webhooks update only the matching subscription ID, so delayed events cannot clear a replacement contract or recreate a deleted team's billing row. Subscription status synchronization and plan/cancel/resume writes compare the entitlement snapshot read before Stripe I/O, preserving a concurrently purchased contract. Subscription scans paginate to avoid missing older active contracts. Both seat synchronization and team plan changes hold the organization's billing lock through the Stripe quantity update. Seats are also synchronized when a team subscription becomes active, so members who joined while checkout was open are billed.
- IPv6 registration limits normalize compressed, expanded, and zero-padded addresses to one /64 key. IPv4-mapped IPv6 addresses use the native IPv4 key. Existing hashed signup-risk keys cannot be rewritten from hashes; historical rows recorded with the old IPv6 key may not match the corrected key.
- Ad submissions reserve a `review` campaign under the account lock before AI review. All submission attempts, including pending/rejected/failed reviews, count toward the ten submissions per rolling 24 hours; concurrent requests cannot exceed the cap. A failed review marks the campaign rejected and never enables payment. A process interrupted during review leaves an unpayable `review` row, counted until it leaves the 24-hour window.
- `usage_reservation` stores each request's original quota period, allowance, cap, and payer. Only finalized usage contributes to overage; pending estimates never get billed. Late settlements leave a replacement monthly/guest quota untouched and keep their original Stripe timestamp/customer. Keep all receipts for an open quota or meter period and for any period with unsettled requests; deleting individual receipts loses the allocation history and monthly billing totals.

- Chat exports fetch the full saved transcript. PDF prints its text in a temporary print-only view, independently of lazy message loading; it shows the same busy state as Markdown/JSON and reports a fetch failure instead of silently printing a partial conversation. Markdown formatting remains plain text in PDF, matching the text scope of Markdown export. Artifact live previews import React modules from `https://esm.sh`; `script-src` explicitly allows that origin because `srcDoc` previews inherit the parent CSP.
- All non-guest registrations, including Google / GitHub OAuth callbacks and direct ID-token sign-ins, require a major email provider or a restricted educational domain from `src/lib/email-domain-policy.ts`. Custom corporate and disposable domains outside that allowlist are rejected with `EMAIL_DOMAIN_NOT_ALLOWED`, as are forwarding-alias services such as DuckDuckGo Email Protection (`duck.com`). Gmail / Googlemail require Google sign-in, including when the address is supplied by GitHub. This gates new accounts and email changes (the new address must pass the same allowlist); existing accounts on a domain that has since left the allowlist, such as `duck.com`, keep signing in with a password, passkey, magic link, or Google / GitHub, and can change to an allowed address.
- Email registration rejects plus aliases, fragmented dots, and empty dot segments. These local-part restrictions do not apply to provider-verified OAuth identities. Letters followed by digits (e.g. `taro1990`) are an advisory verification signal, not an alias rejection. They are not rejected: they go through the signup Turnstile and mailbox-verification flows when configured, and `isRandomLookingLocalPart` feeds the batch sign-up score below.
- With email configured, a second email sign-up for a still-unverified address with a different password removes the stored password and its sessions, so verifying the mailbox never confirms a password set by someone else; that owner signs in through the verification link and sets a password with a password reset. A password reset signs out every session. Magic-link sign-in for an account with 2FA continues to the two-factor challenge. Guest accounts cannot change their email address.

- Batch sign-ups are limited per network (IPv6 by /64): at most 3 accounts per hour and 8 per day from one network, and 60 per day for school addresses (shared campus networks). The limit covers every non-guest sign-up path (email, magic link, OAuth) and is refused with `SIGNUP_RATE_LIMITED`. It uses the rate limiter above, so set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` on multi-instance deployments; the in-memory fallback is per instance. It needs a resolvable client IP (see `CLIENT_IP_HEADER` below); without one nothing is limited.

- A sign-up that looks like part of a batch (scripted client, a second or third account from one network, a random-looking address on top of another signal) is recorded in `signup_risk`. Its Free allowance is reduced (3M basic / 0.5M premium tokens instead of 10M / 2M) until a payment method is verified, which gives the normal verified allowance. Nothing is rejected. The account is told its Free allowance is limited and that verifying a payment method lifts it (in the usage alert and on the billing page), without saying why. Apply the `signup_risk` migration before deploying.
- Optional quota weights: `FLIXA_USAGE_WEIGHT_INPUT` (default **1**), `FLIXA_USAGE_WEIGHT_CACHE_READ` (**0.1**), `FLIXA_USAGE_WEIGHT_CACHE_WRITE` (**1.25**), and `FLIXA_USAGE_WEIGHT_OUTPUT` (**5**) weight the respective input/cache/output token counts before the model multiplier. The weighted sum is rounded up. Empty values are unset; parsing preserves `parseFloat` semantics (including numeric prefixes and zero), and invalid, negative or non-finite values use the defaults. Long-context pricing applies to each provider request independently, including each tool step; summed input across requests never triggers the premium. Team overage displays use the actual Pro or Max included limits.
- Ad checkout persists a reservation before contacting Stripe, then rechecks campaign/session state under the fixed-slot lock before recording the result. Failed or uncertain creation retains the reservation until its 23-hour expiry so a retry uses the same Stripe idempotency key. An unpaid checkout never holds the fixed slot: only a running fixed campaign blocks new (or resumed) fixed checkouts, so several advertisers may be checking out at once and the first payment wins. Each account may attempt 10 ad checkouts per minute. Fixed-slot payment conflicts are rejected with a pending-refund marker before Stripe is called; webhook retries recover the same idempotent refund, and only successful refunds are marked complete. Stripe network calls run without holding the global ad transaction lock.

- Deni AI Ads: users submit text creatives at `/settings/ads`. The campaign list shows a loading indicator until the initial request finishes, and shows an error with retry instead of a false empty state if loading fails. Advertisers can filter all, active, rejected, or ended campaigns (including exhausted budgets and expired fixed placements), with three campaigns per page; unpaid approved campaigns remain visible under All. OpenRouter AI reviews the text and URL before Stripe checkout; a failed review never enables payment. Stripe's `checkout.session.completed` webhook activates paid campaigns; the advertiser's campaign list also verifies incomplete activations directly with Stripe, so a delayed webhook does not offer a second payment. To bound Stripe traffic, each list request verifies only the three newest unpaid checkouts, at most 10 times per minute per account; the others show as resumable, and resuming one confirms it with Stripe first. Set `OPENROUTER_API_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`, and apply the generated ads migration before enabling this feature. Prepaid CPM costs ¥200/1,000 views (¥1 per five unique views); CPC costs ¥30 per unique click; the single fixed chat slot costs ¥3,000 for 30 days. Budgets for CPM/CPC are ¥300–100,000, charged in advance. Stripe Checkout accepts promotion codes for ad payments; discounts reduce the amount charged, not the campaign's prepaid budget or fixed-slot duration. Signed-in free-tier users and anonymous guest sessions see ads (never paid users or the advertiser's own campaign). Anonymous guest views and clicks count as half a billable view/click (¥15 per guest CPC click); normal views count ¥1 per five and guest views count ¥1 per ten. Views are counted only when at least half of the ad is visible; one view/account/campaign/10 minutes and one click/account/campaign/day count for billing. Ads stop when budget is spent. The fixed slot takes priority over rotating campaigns. Deni AI Ads also appear beneath the start buttons in the public `/home` Hero (and its Japanese version). Visitors without a session are identified by a server-side HMAC of their client IP and counted at the same 0.5 view/click weight as anonymous guest sessions (¥1 per ten views; ¥15 per CPC click). The identity is per network (one IPv4 address, or one IPv6 /64, since a single subscriber controls a whole /64): repeat views from the same network/campaign within a ten-minute billing window and clicks within a daily billing window are deduplicated, including visitors sharing a network. Each network also bills at most 120 guest views per hour and 20 guest clicks per day across all campaigns, anonymous guest sessions included; beyond that, ads still display and open but are not billed. Delivery tokens bind to the hashed network; raw IPs are not stored in ad events or exposed in tokens. No account is created just to display an ad. Configure how the client IP is resolved (see [Client IP behind proxies](#client-ip-behind-proxies)) and block direct access to the app server to prevent IP spoofing and fraudulent billing. If no valid client IP can be resolved, visitors can still open ads via direct links, but those deliveries are not counted or billed. Signed-in free users and anonymous guest sessions use the existing account-bound view/click tracking; paid users see no Deni AI Ads. The chat start screen also shows a Deni AI ad below the composer. In conversations, a single Deni AI ad appears below the latest completed assistant answer (not on the empty new-chat screen or while a reply is streaming). The next ad is prefetched while the reply is in progress; if the request is still pending at completion, a compact loading state is shown until the ad arrives. Each completed answer requests a different eligible ad when available, otherwise reuses the previous one. Only the clearly labeled ad's "Learn more" button opens the advertiser's site. Titles and descriptions are displayed in at most two lines each; advertisers should put important information first. Ad event rows are used for deduplication; no third-party ad script is loaded. AI review blocks only clearly unsafe categories (e.g. fraud, impersonation, illegal content); ordinary comparative claims and vague slogans are allowed. It checks creative text and the URL, not the destination site's contents. Advertisers choose Japanese or English for the default title/description and may optionally add a title/description variant only in the other language; both versions are AI-reviewed, and the chat banner uses the viewer's app language with the default text as fallback. Existing campaigns without a recorded default language keep their previous language-variant behavior until edited. Advertisers also choose target languages (Japanese, English, or both; at least one): a campaign is delivered only to viewers whose app language is selected, and existing campaigns target both. Target languages can be changed from the campaign list without a new AI review. The single fixed slot is still shared across languages, so a fixed campaign targeting one language leaves viewers in the other language with rotating campaigns. Advertisers can edit their ad title, description, language variants, and HTTPS destination from the campaign list; changes are AI-reviewed before publication, and a rejected revision leaves the previously approved/live ad unchanged. Rejected unpaid ads can be corrected and reviewed in place. Pricing, budget, and fixed-slot dates cannot be changed through edits. Click tokens bind to the original destination so a pre-edit card never redirects to a different URL. Delivery tokens bill views and clicks for one hour; after that, a click on the same card still opens the advertiser's site but is not billed. Click-origin validation uses the public origin configured by `NEXT_PUBLIC_BETTER_AUTH_URL`, not the internal request host, so redirects work behind a reverse proxy; the proxy must preserve the browser's `Referer` and `Sec-Fetch-Site` headers. Review policy and refund handling before enabling external paid advertising.
- Remove old `NEXT_PUBLIC_ADSENSE_*` configuration from deployments; AdSense and `ads.txt` are no longer used.

- Empty optional vars are treated as unset (`emptyStringAsUndefined` in `src/env.ts`), which helps Docker / Dokploy builds that inject `""` for missing keys.
- Provider keys are capability switches: missing `ANTHROPIC_API_KEY` falls back to OpenRouter, missing `DENI_API_KEY` disables memory (extraction uses GPT-6 Luna on the Deni AI API), missing `EXA_API_KEY` disables web search, and missing Stripe keys disables billing.
- Guest sessions use only `gpt-6-luna` and have twice the basic request allowance of the standard guest limit (40 requests). Because a guest request costs one unit regardless of size, guest prompts are capped at about 32K estimated tokens (rejected with 413 before any usage is reserved: `guest_attachment_too_large` when the attachments push an otherwise short prompt over the cap, `guest_prompt_too_long` otherwise). The cap counts the text plus each image at 2,000 tokens (providers bill images by their resized resolution) and each PDF at one token per 3 bytes of the file, at least 25,000, whether attached by URL or inline; a PDF is billed by its pages, so its size is the bound. Inline files are measured by their decoded data and URL files by the copy downloaded before the check, and a PDF whose size is unknown counts as the 10 MB maximum, so a guest prompt fits one PDF of up to roughly 90 KB. Tool results from earlier turns are resent shortened to 2,000 characters. Output is capped at 16,384 tokens per step with reasoning effort capped at medium (higher efforts could spend the whole cap on hidden reasoning; an effort the model does not support falls back to the model's preferred one first, then is capped), the tool loop at 8 steps, and automatic memory saving is skipped.
- Attachment storage: with `UPLOADTHING_TOKEN` set, uploads are stored as private UploadThing files and recorded in the `attachment` table (apply the generated migration first). In the UploadThing dashboard, allow ACL overrides (every upload requests `acl: "private"`) and allow overriding the signed URL expiry. A deployment that never stored public files can also make the default file ACL **private**; one with public uploads switches it only at the end of the rollout below. The upload route returns the app URL `/api/attachments/<id>`, never a storage URL. That route requires a session and answers 404 unless the signed-in user owns the stored file (so another user's id is indistinguishable from a missing one), then redirects with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` to a signed URL valid for 10 minutes. Chat requests may carry the app URL relative or absolute on `NEXT_PUBLIC_BETTER_AUTH_URL`. The chat server looks each id up before validating or downloading anything: a request referencing another user's file is rejected with 400 (`Invalid or oversized attachment`), a missing, unfinished or deleting file of the user's own reaches the model as an "unavailable" notice (so a chat whose file is gone keeps working), and the user's own stored files get a 5-minute signed URL that only the server uses: it downloads images and PDFs and inlines text files itself, so model providers receive the file bytes or text, never a signed or app URL (an app attachment URL outside a user's file part is replaced by the notice for the same reason). The saved chat keeps the stable `/api/attachments/<id>` URL. Data exports use 15-minute URLs (`ATTACHMENT_*_URL_TTL_SECONDS` in `src/lib/upload.ts`). Each account has an attachment storage quota counting stored files plus uploads in progress: guest 20 MB, Free 100 MB, Plus 500 MB, Pro and lifetime Pro 1 GB, Max 2 GB; team members follow their team plan (Pro Team 1 GB, Max Team 2 GB). Sizes are binary (1 MB = 1 MiB). The quota is reserved under a per-user PostgreSQL advisory lock before the upload starts, so parallel uploads cannot pass it; an upload past it is rejected with 413 (`reason: "storage_quota_exceeded"`). A failed upload gives its reservation back, and a reservation left by an upload interrupted for over an hour is dropped by the storage cleanup below or on the owner's next upload. Each file is uploaded with its attachment id as the UploadThing custom id, so dropping a reservation also deletes a file whose storage key was never recorded. Sending a message ties its uploads to the chat (the first chat that sends a file keeps it). Deleting the chat, or all chats, marks those rows `deleting` in the same transaction (except a file another chat of the same owner still references by its app URL, for example a re-imported copy of the chat: it moves to the most recently updated such chat and is kept), which gives the quota back at once; once it commits, the files are deleted and then the rows of the files that are gone. A file UploadThing fails to delete keeps its marked row (never served or sent to a model again) for the cleanup to retry. Uploads never tied to a chat (removed from the composer, never sent, or whose chat was deleted another way) are deleted with their files once they are 24 hours old. Deleting an account (including a guest removed after linking an account) deletes its stored files once the user row is gone, and `pnpm run tools:purge-anonymous` deletes the stored files of the guests it purges; both are best effort, since the rows are gone with the user (failures are logged; the purge tool lists them and exits 1). When storage is configured but an upload fails, the route returns 502 instead of falling back to an inline data URL, which would bypass the quota. Settings → Import replaces a file part whose app attachment URL is not a file of the importing user (another account's export of this deployment, or a deleted file) with an "[An attached file could not be imported.]" notice and reports it in the import warnings; kept as is, it would make every request of the imported chat fail with 400. Settings → Billing shows the storage used. Files uploaded before private storage keep their public URLs (still readable by the chat server) until the migration tool below moves them. A tab loaded before the migration still sends those public URLs: the chat server looks them up by storage key and treats each of the user's own migrated files as its app URL (signed for the server's download, and saved as `/api/attachments/<id>`, so the chat is not reverted to the dead public URL); one not migrated, or recorded for another account, is left to its public URL.
- Attachment storage cleanup: schedule authenticated `GET /api/cron/storage-cleanup` calls every hour (`Authorization: Bearer <CRON_SECRET>`; disabled with 503 while `CRON_SECRET` is unset, and a no-op without `UPLOADTHING_TOKEN`). Each run marks for deletion up to 500 uploads still pending after an hour and up to 500 files untied from any chat for 24 hours (oldest first), then deletes the files and rows of up to 500 marked rows, including ones a failed chat deletion left behind. It returns `{ marked, deleted, failed }` and answers 503 while files fail to delete (their rows stay for the next run): alert on repeated 503s. Increase the frequency if the backlog grows. The same run also deletes expired data exports (see Account data export below) and reports them as `exports: { deleted, failed }`.
- Account data export (Settings → Account → Download your data): with `UPLOADTHING_TOKEN` set, the export is built in the background and stored as a private file (apply the generated `account_export` migration first). A request (at most one per minute per user, logged as "Account data exported" in the security activity) creates a `pending` row and schedules the job with Next.js `after()`, which runs once the response is sent: a Node.js server (`next start`, Docker) also waits for it on graceful shutdown, while a serverless host must let it finish within the tRPC route's maximum duration. While an export is pending, another request returns it instead of starting a second. The job builds the same JSON as before (chat transcripts read in pages), uploads it as `deni-ai-export-YYYY-MM-DD.json` (private, `application/json`, served as a download, with the export id as its custom id) and marks it ready for 7 days; a failure marks it failed (the reason is logged, not shown). A row still pending after 30 minutes lost its job (restart, crash, time limit): it reads as failed and can be retried. Settings polls every 4 seconds while an export is pending, then shows its size, expiry and a Download button; each download asks the server for a 15-minute signed URL, issued only to the owner of a ready, unexpired export. A new ready export replaces the user's older ones (their files are deleted). Export files do not count toward the attachment storage quota. The hourly storage cleanup deletes expired exports, and failed or abandoned ones older than 7 days, with their files (up to 500 of each per run); deleting an account, or purging guests with `pnpm run tools:purge-anonymous`, deletes its export files too. No email is sent when an export is ready. Without `UPLOADTHING_TOKEN` (local development) the export is built in the request and downloaded directly, as before, and Settings ignores export rows left from a time storage was configured.
- Attachment storage rollout (from public uploads): (1) in the UploadThing dashboard, allow ACL overrides and overriding the signed URL expiry, and keep the default file ACL **public**: until the new code is deployed, uploads still request no ACL and are served by their public URL, and the legacy files must stay public until the migration has rewritten their chats; (2) apply the generated migration and deploy; (3) schedule the storage cleanup above; (4) run `pnpm run tools:migrate-private-attachments` (dry run: chats, files, and the storage each account gains against its quota; files referenced by more than one account are left public and listed), then the same command with `--apply` (optionally `--limit=<n>` per run) until a dry run reports no chats left. It records an `attachment` row per legacy file in its chat's owner's name, rewrites the saved URLs to `/api/attachments/<id>` and makes the files private, one chat per transaction, and never deletes anything; (5) verify: open an old chat with an image (it loads through `/api/attachments/<id>`), continue it (the model still sees the file), and check that an old public `https://<appId>.ufs.sh/f/<key>` URL no longer serves the file; (6) optionally, once the migration is done and the files it left public for review are resolved, switch the dashboard's default file ACL to private (depending on how UploadThing applies the default, files uploaded without an explicit ACL may become private too). Migrated files count toward their owners' quotas: an account over its quota can still chat but cannot upload until it deletes chats with attachments.
- Each web `search` tool call consumes 10,000 basic tokens (1 basic request for guests). Failed searches are refunded. Browse does not consume a separate search charge. Image and video generation have been removed.
- Browse validates every redirect and pins direct HTTP(S) connections to validated public DNS answers. Direct and reader responses are limited to 2,000,000 bytes while streaming. The direct path uses Node HTTP(S), so it requires the Node.js runtime.
- API key creation and device authorization share an account-row lock inside a PostgreSQL transaction; the five-key cap applies across instances. No schema migration is needed for this lock.
- Usage reservations and settlements serialize on the account row. Final quota reconciliation, the original payer's ledger, the receipt, and the Stripe outbox commit together. Member caps include outstanding reservations at admission and cap actual overage at settlement. Token counters use PostgreSQL `bigint` so Max Mode can exceed 2.1 billion tokens without integer overflow. Apply the generated migration before deploying these changes.
- Stopped or replaced chat generations still settle their own receipt. Completed provider usage is persisted, and active requests refresh their receipt every 30 seconds. Providers report usage when a model call ends, so a stop while a step runs its tools keeps that call's reported usage. Once output has streamed, a call the provider accepted but that was cut off before it ended by Stop, replacement, disconnect or an upstream error (including while it is still reading the prompt or reasoning before its first streamed part) is billed at an estimate: its prompt plus the output streamed so far. The prompt is the larger of its text and the input the provider reported for the last call whose prompt it starts with (attachments included), plus the messages added since; that report comes from an earlier call of the same request, or from the first call of a recent request for the same chat and model (within 5 minutes, on the same instance) whose system prompt, tools and messages this prompt still starts with. The part of the prompt the provider last reported reading from cache, or the reported prompt it was just sent, is billed at the cache-read weight and the rest at full input weight. A first call with no earlier report counts its attachments at nothing. A call counts as accepted once the provider opens its stream; a call the provider rejects (for example 429, 503 or a context-window error, which throw before that, on every retry) is not billed, including when Stop lands while the SDK waits to retry it, and a generation stopped before any output is still fully refunded. The token reservation counts each URL-referenced attachment at a floor (2,000 tokens per image, 25,000 per PDF) because those files are downloaded only after admission; the floors are reserved only and never billed on their own. The authenticated retry route recovers receipts silent for 15 minutes using observed usage, returning the unused estimate. Configure `CRON_SECRET` and the scheduler even when Stripe is disabled. Quota-reset rewards do not erase accrued charges or a team ledger.
- Model availability: a production server (`NODE_ENV=production`) probes the models in-process every 5 minutes, starting 10 seconds after boot. Each probe sends a 1-token request to `gpt-6-luna` and `gpt-5.6-luna` (both Deni AI API), `gemini-3.8-flash` (OpenRouter/Google) and `claude-haiku-5.5` (OpenRouter/Anthropic) and stores the latest result in `model_health` (apply the migration first). `GET /api/status/models` returns the public status and the model picker shows it: a probed model shows its own result, and any other model shows the worst result among the probes on its route. With more than one replica every replica probes, and serverless hosts cannot run the in-process timer; in those cases schedule `GET /api/cron/model-health` with `Authorization: Bearer <CRON_SECRET>` instead. The probes consume a few tokens per run and the cron route returns 200 even when a model is unavailable.
- Regenerating an older answer branches at the selected answer and restarts subsequent turns. Existing alternatives for that answer remain available in the current chat pane. If a regeneration fails or is stopped before the new answer starts, the original answer and the turns after it are kept, both on screen and in the saved chat.
- Stop also cancels a request whose generation has not started yet: right after registering the generation, the server checks whether a stop for that chat arrived after the request did, and if so saves the question without generating or charging an answer. The stop route remembers the stop in memory for the same instance and records its arrival time on the chat row (`chats.stop_requested_at`, apply the migration first) before looking for a generation to stop, so a request registering on another instance either sees the stop or is stopped by it. Arrival times come from each instance's clock, so keep instance clocks synchronized (NTP). A client disconnect is not a stop: the generation, including attachment downloads before it, continues in the background and the client picks up the answer when it returns.
- Pending-answer recovery merges the latest server message window into loaded history using message IDs, so loading older messages does not prevent recovery. A snapshot for an older turn does not replace a newer local question.
- Prompts supplied through `/new/<prompt>` or `?message=` prefill the composer for manual submission. They preserve literal percent escapes after normal URL decoding; they are never decoded a second time.
- Organization removal/role-change audit events are written only by better-auth's server hooks. The auth route provides the authenticated actor through request-local storage; direct server callers must use `withTeamAuditActor`. Clients cannot submit their own audit events.
- Joining an organization cancels a personal subscription only when membership and a live licensed team subscription are verified. Free/unpaid teams or Stripe verification errors leave the personal plan untouched. Invitation links (`/settings/team?invitationId=…`) only highlight the invitation; joining always takes an Accept click and a confirmation that warns when the personal subscription would be canceled.
- Team audit log entries outlive their actor's account: `team_usage_audit_log.actor_user_id` is nullable with `ON DELETE SET NULL`, and the audit views show such entries as a deleted user.
- Team billing identity is organization-scoped, serialized with a PostgreSQL advisory transaction lock. Existing per-admin copies are retained for ledger history but ignored for entitlement; subscription synchronization/revocation updates all copies.
- A team billing row belongs to its organization, not to a person: `billing.user_id` only names its billing contact, is nullable with `ON DELETE SET NULL`, and is required for personal rows by the `billing_personal_user_check` constraint (`billing_organization_idx` serves the per-organization lookup). When the contact leaves the team, is removed, or deletes their account, the row keeps billing the team with `user_id` NULL and is reused, never duplicated; self-service account deletion clears the contact itself before anything in Stripe or sign-in data changes. Team Stripe webhooks are applied by organization even when no existing user can be credited, and their audit entries then show a deleted user. When any member leaves, is removed, or deletes their account, the team's Stripe customer email is changed (best-effort) to the email of the team's earliest current owner if it is that member's address or the customer was created for that member; an address the team set on a customer someone else created is left alone.
  Apply this migration and deploy the code in the same maintenance window, code first. Neither version is fully safe on the other's schema:
  - New code on the old schema: a team's billing contact cannot delete their account (the request fails before anything in Stripe or sign-in data changes, instead of the old `ON DELETE CASCADE` deleting the team's billing row), and a member who leaves stays the contact (`Failed to release the team billing contact` is logged; the invoice email still moves).
  - Old code on the new schema: deleting an account that has a personal billing row fails on the new constraint only after better-auth has removed the user's sessions and sign-in accounts, leaving an account nobody can sign in to.
  - Optionally, after migrating, clear contacts who left their team before this change: `UPDATE billing SET user_id = NULL WHERE organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM member WHERE member.organization_id = billing.organization_id AND member.user_id = billing.user_id);`
- Personal/team plan changes use Stripe `error_if_incomplete`: a failed upgrade payment must not grant the requested tier. Requests requiring further payment authentication are rejected instead of applying an unpaid upgrade. Both are confirmed in a dialog showing Stripe's invoice preview first (`estimatePlanChange` / `estimateTeamPlanChange`, the team one for every seat), and cancelling either subscription asks for confirmation.
- Operator/blog administrator email allowlists require verified, non-anonymous accounts even when email delivery is disabled. Configure a supported mailbox-verification path before relying on these administrator roles.
- Card verification validates the intent's user, customer, and purpose. The shared card fingerprint is locked and its eligibility plus verification claim committed together before external follow-up, preventing simultaneous free-tier claims above the card limit. Removing a card keeps its fingerprint and sets `billing.card_removed_at`, so the account loses the verified-free boost but the card's slot stays taken. Cards cannot be removed while Stripe still has a live subscription (including one canceling at period end or the Max Mode meter subscription) or draft/unpaid invoices.
- Purchases are recorded only by the Stripe webhook and the live-subscription sync; there is no client-side checkout confirmation. Checkout refuses a one-time (lifetime) plan while a subscription still renews, or when that plan was already bought, even if a later subscription currently occupies the billing row. A stored open checkout session is reused only for the same plan, price, and flash offer state; otherwise it is expired before a new one is created.
- Better Auth self-service organization leave is audited server-side and reconciles licensed seats after successful authorization, just like member removal.
- Device approval requires the configured public origin and `application/json`; initiate/poll remain available to extension clients without a browser Origin. Reverse proxies must preserve the browser's Origin header.
- `pnpm test` includes both `tools/*.test.ts` and `src/**/*.test.ts`.
- When adding or changing supported models, update `src/lib/constants.ts`.
- `OPENROUTER_API_KEY` routes OpenAI-family and other OpenRouter models when voids mode is off. It also serves as the Anthropic fallback when `ANTHROPIC_API_KEY` is absent.
- Optional voids.top mode: set `VOIDS_MODE=true` (or `1`) and provide **`VOIDS_API_KEY`** to send OpenAI and Anthropic traffic through the OpenAI-compatible voids.top gateway. Without the key, normal provider routing is used. Optional `VOIDS_BASE_URL` (default `https://capi.voids.top/v2`). When `VOIDS_MODE` is off, OpenAI uses OpenRouter and Anthropic uses its native key when present, otherwise OpenRouter.
- Optional Deni AI API: set **`DENI_API_KEY`** (and optionally **`DENI_API_BASE_URL`**, default `https://api.deniai.app/v1`, an OpenAI-compatible Chat Completions endpoint) to expose OpenAI models, including GPT-6 Luna. OpenAI models on this route are sent as `openai/<id>` (e.g. `openai/gpt-6-sol`) and do not offer Pro or Fast mode. A missing key hides those models.
- Operator administration: set `ADMIN_EMAILS` to a comma-separated list of account emails that can grant usage reset credits from **Settings → Billing** and receive dispute alerts. The address is read only on the server. The former name `AFFILIATE_ADMIN_EMAILS` is still read when `ADMIN_EMAILS` is unset; rename it when convenient.
- Blog administration: set `BLOG_ADMIN_EMAILS` to a comma-separated list of account emails that can write and publish posts at `/settings/blog`. If omitted, `ADMIN_EMAILS` is used.
- **Email (Cloudflare Email Sending):** requires a Workers Paid plan and the sending domain (e.g. `deniai.app`) onboarded under **Email Service → Email Sending** in the Cloudflare dashboard (DNS/SPF/DKIM managed there). Create an API token with **Email Sending: Edit**, then set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. From address defaults to `Deni AI <noreply@deniai.app>` (`EMAIL_FROM` in `src/lib/constants.ts`). When either env var is missing, magic link / verification / invite emails are disabled, and so is changing an account's email address. With email configured, a verified account changes its email in two steps: the current address approves the request, then the new address receives a verification link, and the email updates only after that link is opened.

#### Generate `BETTER_AUTH_SECRET`

The secret must be **exactly 32 characters** (Zod `length(32)`):

```bash
# 32 hex chars
openssl rand -hex 16

# or base64 truncated to 32
openssl rand -base64 24 | cut -c1-32
```

#### Setting up OAuth providers

**Google OAuth**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Configure the OAuth consent screen
4. Create OAuth 2.0 Client ID (Web application)
5. Authorized redirect URI: `{NEXT_PUBLIC_BETTER_AUTH_URL}/api/auth/callback/google`  
   Local example: `http://localhost:3000/api/auth/callback/google`

**GitHub OAuth**

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Authorization callback URL: `{NEXT_PUBLIC_BETTER_AUTH_URL}/api/auth/callback/github`  
   Local example: `http://localhost:3000/api/auth/callback/github`

### 4. Set up the database

```bash
# Generate migration files after schema edits
pnpm run db:generate

# Apply migrations
# Production-style (.env.production):
pnpm run db:migrate

# Local development (.env.local):
pnpm run db:migrate:dev

# Or push schema directly (dev only)
pnpm run db:push
```

Regenerate better-auth tables into `src/db/schema/auth-schema.ts` (overwrites that file):

```bash
pnpm run auth:generate
```

Better Auth 1.7 keys linked accounts by `(issuer, accountId)`. After upgrading, apply the generated migration (adds `account.issuer`, backfills Google / GitHub / credential rows, then creates the unique index) before OAuth sign-in will work.

### 5. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command                       | Description                          |
| ----------------------------- | ------------------------------------ |
| `pnpm dev`                    | Start Next.js dev server             |
| `pnpm run build`              | Typecheck + production build         |
| `pnpm start`                  | Start production server              |
| `pnpm run lint`               | oxlint                               |
| `pnpm run lint:fix`           | oxlint with auto-fix                 |
| `pnpm run format`             | Format with oxfmt                    |
| `pnpm run typecheck`          | TypeScript check (`tsc --noEmit`)    |
| `pnpm run db:generate`        | Generate Drizzle migrations          |
| `pnpm run db:migrate`         | Migrate using `.env.production`      |
| `pnpm run db:migrate:dev`     | Migrate using `.env.local`           |
| `pnpm run db:push`            | Push schema (dev)                    |
| `pnpm run auth:generate`      | Regenerate better-auth schema        |
| `pnpm run disposable:refresh` | Refresh disposable-email domain list |
| `pnpm run tools:codename`     | Generate version codenames           |
| `pnpm run tools:update-types` | Add missing Lucide type exports      |
| `pnpm run tools:commit`       | AI-assisted conventional commits     |
| `pnpm run doctor`             | Run react-doctor diagnostics         |
| `pnpm test`                   | Run local regression tests (Vitest)  |

TypeScript scripts run through `tsx`. Unlike Bun, Node.js does not automatically load
root environment files: the package scripts explicitly load `.env.local` when appropriate,
and production migrations/maintenance use `.env.production`. For ad-hoc scripts, use
`pnpm exec tsx --env-file=.env.local path/to/script.ts`.

## Stripe billing

Deni AI Ads submission, editing, checkout, and view tracking require the browser `Origin` to match `NEXT_PUBLIC_BETTER_AUTH_URL` (the public origin), even behind a reverse proxy. If these requests return 403 in production, check that the configured URL matches the address in the browser, including scheme and hostname; an internal container URL is not valid. New Stripe checkout and billing portal return URLs use the public origin even if the configured URL ends in `/`; already-open Stripe sessions keep their original return URL until they expire.

Stripe billing is enabled only when the Stripe secret and publishable keys are configured. Checkout UI needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Webhooks need `STRIPE_WEBHOOK_SECRET` in production. If the Stripe keys are omitted, billing UI and paid billing procedures are disabled.

1. Create a [Stripe account](https://stripe.com/) and copy API keys
2. Add keys to `.env` (see template above)
3. Webhook endpoint: `{NEXT_PUBLIC_BETTER_AUTH_URL}/api/stripe/webhook`
4. Suggested events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `radar.early_fraud_warning.created`
5. Local forwarding:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

To hide billing in the client:

```env
NEXT_PUBLIC_BILLING_DISABLED=1
```

Optional flash offer coupon: `STRIPE_FLASH_OFFER_COUPON_ID`. For 24 hours after a user first opens billing, the coupon discounts yearly and lifetime plans, and the billing page shows an offer banner with a countdown. Verifying a card grants a one-time 48-hour offer from that moment (tracked by `billing.card_offer_granted_at`, so removing and re-verifying a card does not grant another), and users with an active offer who have verified a card also see a dismissible offer strip at the top of the app. Without the coupon (or if it is invalid), no offer is shown.

Dispute handling is automatic when those extra webhook events are enabled. On `charge.dispute.created` the app emails admins and cancels the related subscription (immediately for fraud, otherwise at period end). Evidence is not submitted automatically; contest from the Stripe Dashboard if needed. On `radar.early_fraud_warning.created` it refunds as fraud only when the payment is still actionable, 3D Secure did not authenticate it, and the account has no post-payment service use. Alerts go to `ADMIN_EMAILS` / `BLOG_ADMIN_EMAILS` when Cloudflare email is configured.

Checkout and card verification always request 3D Secure (`request_three_d_secure: any`), matching the Radar policy that also blocks `:card_3d_secure_support: = 'not_supported'`. A verified card unlocks the full chat model catalog for free accounts (subject to the verified-free token limits); guests remain limited to the guest model. Signed-in free users without a verified card see a reminder at the bottom of the model selector's right panel; it stays visible while scrolling the model list and is hidden for verified-card users, paid users, guests, and deployments with billing disabled.

Keep a Terms of Service URL in Stripe public details (`https://deniai.app/legal/terms`). Optional: turn on [Smart Disputes](https://dashboard.stripe.com/settings/disputes) if you want Stripe to help assemble network evidence.

Anonymous guest sessions cannot use billing endpoints or create Stripe customers; sign in to a permanent account first. Personal and team billing fetch profiles and search/create Stripe customers before opening a database transaction. Account/organization idempotency keys prevent concurrent duplicate customer creation; short advisory-lock transactions recheck and insert billing rows. Customer searches use account/organization metadata rather than email and fail closed on search errors. Creation retries are idempotent. On account deletion, team owners must delete their team or transfer ownership first (checked again server-side before Stripe/customer deletion). Other members, including a former owner or the team's billing contact, can delete their account while the team keeps paying; the team's subscription, customer, and billing row are left to the organization. Active personal subscriptions block deletion. For a prepaid subscription already scheduled to end, users can wait and return after it ends (no automatic account deletion), or delete now and forfeit remaining access without a refund. A subscription carrying metered usage must finish its scheduled period and final billing first. Unsettled requests, undelivered meter events, and draft/unpaid invoices also block deletion. The hook rechecks pending usage under the account lock and freezes new usage before canceling prepaid subscriptions without proration or invoicing and removing personal Stripe customers. The personal billing row is deleted explicitly right before the user row on every deletion path (including guest cleanup), since it may not outlive its user. A failed deletion can be retried. Lifetime-plan activation rechecks the live charge under the same account lock as reversal handling; refunds/disputes revoke only their matching checkout, preserving newer contracts. A dispute that closes as won (or an inquiry closed without escalation) restores that lifetime plan unless a newer contract replaced it. Team customers remain owned by their organization. Existing duplicate customers are not automatically merged; check their subscriptions and payment methods before manually reconciling them.

Plan prices are resolved by Stripe `lookup_key` matching `src/lib/billing.ts` (`plus_monthly`, `pro_team_yearly`, `max_team_monthly`, and so on). Team plans are licensed per seat. Add Max for Teams by creating prices with lookup keys `max_team_monthly` and `max_team_yearly` (same licensed/seat model as `pro_team_*`). Missing team lookup keys are skipped in the team billing UI; checkout still errors if that specific price is missing.

### Max Mode metered billing

Max Mode overage is billed **monthly** through [Stripe Billing Meters](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api), even when the plan subscription is yearly. Monthly plans get meter items on the same subscription. Yearly plans get a separate monthly Max Mode subscription so Stripe can invoice overage every month. Usage ledgers advance once with the actual meter host's monthly period and retain usage already settled in that new period. Delayed/duplicate events cannot erase new usage or reset another team's ledger. Disabling and re-enabling Max Mode preserves incurred usage. The separate Max Mode subscription charges the plan subscription's card, and enabling serializes per Stripe customer so only one exists; extra same-currency ones are canceled without invoicing. When any subscription carrying the meters ends (including a monthly plan), Max Mode turns off. While the separate Max Mode subscription is past due, unpaid, paused, or incomplete, Max Mode is suspended and cannot be enabled again until its invoice is paid. Immediate cancellations by the app (joining a paid team, deleting a team, moving the meters to another subscription) issue a final invoice for accrued usage.

Create the meters and prices once (idempotent):

```bash
pnpm exec tsx --env-file=.env.local ./tools/stripe-max-mode-setup.ts
```

That script creates:

| Meter event name   | Lookup key               | Rate (USD default)     |
| ------------------ | ------------------------ | ---------------------- |
| `max_mode_basic`   | `max_mode_basic_month`   | $0.01 per 1,000 tokens |
| `max_mode_premium` | `max_mode_premium_month` | $0.05 per 1,000 tokens |

Configure both USD and JPY availability for each Max Mode price (as currency options or matching active prices). The app reads the currency from the customer's active plan subscription: JPY subscriptions use JPY Max Mode prices, while USD subscriptions use USD prices.

Without these lookup keys, Max Mode can still record usage locally but enabling it (and invoicing) fails until the prices exist.

### Customer Portal

Personal and team billing settings open the Stripe Customer Portal. Plan and seat changes must go through the app (`changePlan` / `changeTeamPlan`): it invoices prorations immediately, rejects incomplete payments, updates subscription metadata, re-attaches Max Mode meter items, and keeps team seats equal to the member count. The portal must therefore **not** allow subscription updates (switching plans or changing quantities).

Create a dedicated portal configuration (idempotent: a rerun updates the configuration it created, found by its `managed_by=deni-ai` / `purpose=customer_portal` metadata):

```bash
pnpm run tools:stripe-portal                                             # loads .env.local
pnpm exec tsx --env-file=.env.production ./tools/stripe-portal-setup.ts  # production keys
```

The configuration disables subscription updates; allows cancellation at period end without proration (the app treats `cancel_at_period_end` as a grace period), payment method updates, invoice history, and customer email/name/address/tax ID updates; and keeps the hosted login page off. When `NEXT_PUBLIC_BETTER_AUTH_URL` is `https`, it also sets the privacy policy and terms links and the default return URL (`/settings/billing`). Set the printed ID as `STRIPE_PORTAL_CONFIGURATION_ID`; every portal session then uses it. Test and live mode have separate configurations, so run it with each secret key.

If `STRIPE_PORTAL_CONFIGURATION_ID` is unset, portal sessions use the account's **default** configuration from the [Dashboard](https://dashboard.stripe.com/settings/billing/portal). In that case the default configuration must have subscription updates disabled (no plan switching and no quantity changes); otherwise customers can bypass the app's plan-change and seat-count handling.

Report the configuration in use without changing anything (exits non-zero when it allows subscription updates):

```bash
pnpm run tools:stripe-portal --check
```

## Database schema

Schemas live under `src/db/schema/`. Main domains:

| Area                  | Purpose                                       |
| --------------------- | --------------------------------------------- |
| **auth-schema**       | Users, sessions, accounts, orgs (better-auth) |
| **chat**              | Conversations and messages                    |
| **api-keys**          | User API key records                          |
| **memory**            | Personalization memories                      |
| **project**           | Project context; legacy file records retained |
| **billing**           | Stripe subscriptions / payment data           |
| **usage**             | Platform usage and limits                     |
| **reset-credit**      | Usage reset credit balances                   |
| **team-usage-policy** | Team usage policies                           |
| **device-auth**       | Device / desktop auth                         |

Schema change workflow:

1. Edit files in `src/db/schema/`
2. `pnpm run db:generate`
3. `pnpm run db:migrate` or `pnpm run db:migrate:dev` (or `db:push` in dev)

## Deployment

### Vercel (common for this stack)

1. Push the repo to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Set the core environment variables and any optional provider keys you want to enable
4. Deploy (build uses `pnpm run build` / `next build` per project settings)

### Docker / Dokploy

A multi-stage `Dockerfile` is included for self-hosting (e.g. Dokploy):

- **Install:** pnpm 12.8.1 (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), with a frozen lockfile.
- **Build:** Node 22 runs `next build` (standalone output). Typecheck is skipped in the image (`SKIP_TYPECHECK=1`) so tsc does not fight Turbopack on small VPS CPUs — run `pnpm run typecheck` locally or in CI.
- The Node builder mounts pnpm-installed dependencies from the install stage instead of copying `node_modules`, avoiding a large per-deploy file copy.
- **Run:** Node 22 serves `.next/standalone` on port **3000**
- Turbopack's `.next/cache` is stored in a BuildKit cache mount, so later deploys on the **same Dokploy host** compile incrementally. Do not enable “disable cache” / `--no-cache` in the service settings.
- `NEXT_PUBLIC_*` values must be present at **build time** (inlined into the client bundle)
- Server secrets should also be available at build time for `@t3-oss/env-nextjs` validation / prerender; optional provider keys can be omitted and disable their features

Dokploy application settings (typical):

| Setting         | Value        |
| --------------- | ------------ |
| Build type      | Dockerfile   |
| Dockerfile path | `Dockerfile` |
| Context         | `.`          |
| Port            | `3000`       |
| Build cache     | enabled      |

Put the same keys as production `.env` in the service **Environment** tab, and pass them as **build-time** args/env for `NEXT_PUBLIC_*` plus any provider keys you want enabled during the build. See comments at the top of `Dockerfile`.

Local example:

```bash
docker build -t deni-ai \
  --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://example.com \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=... \
  .

docker run --rm -p 3000:3000 --env-file .env.production deni-ai
```

### Other platforms

Any host that can run a Next.js standalone Node server (Railway, Render, Fly.io, AWS/GCP/Azure, etc.):

- Set the core environment variables and any optional provider keys you want to enable
- Use PostgreSQL (Neon recommended)
- Build: `pnpm run build` (or the Docker image)
- Start: `pnpm start` / `node server.js` (standalone) / container CMD

### Client IP behind proxies

The client IP keys the device-authorization rate limit, and anonymous Deni AI Ads view/click deduplication and billing (all through `src/lib/client-ip.ts`). Configure it for your ingress topology:

| Topology                                                                           | Setting                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------- |
| Cloudflare in front of the app                                                     | `CLIENT_IP_HEADER=cf-connecting-ip`          |
| A proxy that sets one header to the peer IP (e.g. nginx `X-Real-IP`)               | `CLIENT_IP_HEADER=x-real-ip`                 |
| N proxies that append to `X-Forwarded-For` (Traefik, `$proxy_add_x_forwarded_for`) | `TRUSTED_PROXY_HOPS=N`                       |
| An edge that overwrites `X-Forwarded-For` with only the client IP                  | `TRUSTED_PROXY_HOPS=1` (or leave both unset) |

- `CLIENT_IP_HEADER` names a single-value header set by your trusted edge. Only that header is read (case-insensitive); it must contain exactly one IP. It takes precedence over `TRUSTED_PROXY_HOPS`.
- **When trusting a header such as `cf-connecting-ip`, the origin must not be reachable directly**: allow only your edge (e.g. Cloudflare IP ranges, Cloudflare Tunnel, or authenticated origin pulls), otherwise anyone can send the header themselves. Proxies between the edge and the app must pass the header through unchanged.
- `TRUSTED_PROXY_HOPS` counts the trusted proxies that append to `X-Forwarded-For`; the entry that many positions from the right is used, and client-supplied entries to its left are ignored. The count must be exact: too low selects a proxy address (everyone shares one identity), too high selects a client-controlled value. A chain shorter than N resolves no IP.
- With neither set, the first `X-Forwarded-For` entry (else `X-Real-IP`) is used, as before. Clients can spoof this unless the edge strips client-supplied `X-Forwarded-For` / `X-Real-IP`.
- Invalid or missing values resolve no IP: device authorization falls back to a shared rate-limit bucket, and anonymous ad views and clicks are not counted.
- Better Auth (its own rate limiting, session IP, and Turnstile `remoteip`) uses `CLIENT_IP_HEADER` via `advanced.ipAddress.ipAddressHeaders`. `TRUSTED_PROXY_HOPS` is not passed to Better Auth, whose `trustedProxies` option takes proxy IP/CIDR ranges rather than a hop count. Without `CLIENT_IP_HEADER`, Better Auth reads `X-Forwarded-For` only when it holds exactly one entry; behind two or more appending proxies no IP is resolved and its rate limiting falls back to a shared per-path bucket, so prefer `CLIENT_IP_HEADER` there.

## Request and preview security

- Browser mutations must originate from `NEXT_PUBLIC_BETTER_AUTH_URL`. Chat, stop, and tRPC POST requests require `application/json`; attachment uploads require `multipart/form-data`. Cross-origin and sibling-domain browser requests are rejected before authentication or mutation. Clients without an `Origin` header remain supported with the required content type. Set the public URL to the exact origin users open, including the port during local development.
- Request bodies are capped while streaming, including requests with missing or incorrect `Content-Length`: chat 16 MiB, tRPC 2 MiB per request except data imports (`migration.import`, 30 MiB including the envelope for 25 MB of JSON) and comparison transcripts (`chat.saveComparison` 20 MiB: one side's last chat request, at most 16 MiB, plus 4 MiB for its final answer, which no chat request carried; `chat.saveComparisonSession` 40 MiB for both sides in one body, deliberately above the import cap, and read only after the Pro/Max check), chat stop and device authentication 4 KiB. A batched tRPC request gets the smallest limit among its calls, so batching cannot lift a procedure's limit; the client sends those three procedures unbatched (`src/lib/trpc/limits.ts`). A comparison over these limits gets a "too large to save" message instead of a retry prompt. Attachments retain their existing upload limits. The model receives at most the latest 20 binary attachments; older files remain in saved history. Remote binary downloads are limited to 10 MiB per file and 20 MiB per generation, four concurrent downloads, and a 10-second timeout per download batch. Every redirect uses the DNS-pinned public-network transport. Inline binary attachments are also size-checked.
- Advertising view and checkout bodies are capped at 4 KiB; creative submission/edit bodies at 32 KiB. Stripe webhook bodies are capped at 4 MiB and verified against their original raw bytes; unsigned requests are rejected without reading the body. Oversized signed deliveries return 413, so investigate delivery failures before replaying an unusually large event.
- Device polling is limited to 60 requests per minute per resolved IP in addition to the per-code limit; approval attempts are limited to 10 per minute per authenticated account. Configure trusted client-IP headers and shared Redis as appropriate for your deployment; without Redis, limits are local to each process.
- tRPC procedures that call Stripe or read every row on each call are limited per signed-in user with the shared rate limiter (Upstash when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set, otherwise per instance), and refuse further calls with 429 `TOO_MANY_REQUESTS` ("Too many requests. Please try again later.") until that one-minute window, which starts at the first counted call, ends. Each procedure has its own budget per minute: 30 for `billing.status`, `billing.plans`, `billing.flashOffer`, `billing.estimatePlanChange`, `billing.getCheckoutSession`, `organization.teamPlans`, `organization.teamBillingStatus`, `organization.estimateTeamPlanChange`, `organization.invitationBillingImpact` and `organization.getTeamCheckoutSession`; 60 for `billing.maxModeStatus` and `organization.teamMaxModeSettings` (the team Max Mode editor refetches both after every saved field) and for `chat.getChats` (refetched after each sent message, which chat itself limits to 30 a minute); 10 for `billing.accountDeletionStatus`. The client caches these queries for 60 seconds without refetching on focus, so normal use stays several times below the budgets. Budgets are in `TRPC_RATE_LIMITS` (`src/server/api/trpc.ts`); add `rateLimited(name, limit)` before `.input()` on a new expensive procedure.
- Generated HTML opened in another tab runs inside an iframe with `sandbox="allow-scripts"`, without application-origin access. Account exports include team projects only while the creator is still a member. Project mutations recheck current team membership and management rights in the write statement, including membership in the destination team when sharing. Only a project's creator can move it to another team or make it personal again; team owners and admins can still edit, archive, or delete it. When a creator deletes their account, their team projects pass to a current owner (or else admin) of that team instead of being deleted; personal projects are deleted.
- KaTeX is overridden to a fixed release in `pnpm-workspace.yaml`. `shadcn` is a development dependency: install development dependencies in the build stage for its CSS, then deploy the standalone output. Check `pnpm audit --prod` for deployed dependencies and `pnpm audit` for development tools. At the time of this review, the unpatched [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) remains in the development-only shadcn CLI graph; do not process untrusted glob patterns with that CLI and revisit the advisory when a fix is published.

## Troubleshooting

| Issue                         | What to check                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Env validation errors on boot | Missing keys in `src/env.ts`; empty optional strings are OK                                                                                 |
| OAuth redirect mismatch       | Callback URLs must match `NEXT_PUBLIC_BETTER_AUTH_URL`                                                                                      |
| Public links use `0.0.0.0`    | Set `NEXT_PUBLIC_BETTER_AUTH_URL` to the **public** HTTPS origin (not Docker `HOSTNAME=0.0.0.0`). Rebuild so `NEXT_PUBLIC_*` is re-inlined. |
| DB migrate fails              | Correct `DATABASE_URL`; use `db:migrate:dev` for local                                                                                      |
| Stripe checkout broken        | Publishable key + webhook secret; Stripe CLI for local                                                                                      |
| Search / browse tools fail    | Valid `EXA_API_KEY`                                                                                                                         |
| Docker build env issues       | Pass `NEXT_PUBLIC_*` as build args; see `Dockerfile` comments                                                                               |
