# Setup

This guide covers prerequisites, environment configuration, database setup, Docker / Dokploy, and deployment.

Source of truth for validated env vars: [`src/env.ts`](src/env.ts). Starter template: [`.env.example`](.env.example).

## Prerequisites

- [Node.js 26+](https://nodejs.org/) and [pnpm 12.8.1](https://pnpm.io/installation)
- [PostgreSQL](https://neon.tech/) (Neon serverless recommended for self-hosting)
- Core environment values (`DATABASE_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, and a `BETTER_AUTH_SECRET` of at least 32 characters)
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

# Authentication (BETTER_AUTH_SECRET: at least 32 characters)
BETTER_AUTH_SECRET=your-secret-of-at-least-32-characters
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
# Readable stack traces: set at build time to upload source maps (org auth token;
# in Docker, pass it as the SENTRY_AUTH_TOKEN build secret, not a build argument)
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
# Operator email domains (optional; comma-separated, e.g. deniai.app)
# ADMIN_EMAIL_DOMAINS=example.com

# Rate limiting (optional — falls back to in-memory)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# File uploads (optional — without it attachments travel inline as base64 data URLs,
# limited to 512 KB per file, and nothing is stored or counted against a quota)
# Accepted attachments: JPEG/PNG/WebP/PDF up to 10 MB, and text files (.json, .csv, .md, .txt,
# source code, ...) up to 2 MB. Text files are inlined into the prompt.
# Files are stored private in a Cloudflare R2 bucket: see "Attachment storage" in the
# notes below. All four are required; the R2 API token needs Object Read & Write on the bucket.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# Client IP behind proxies (optional; see "Client IP behind proxies" below)
CLIENT_IP_HEADER=
TRUSTED_PROXY_HOPS=

# Optional: hide billing UI / disable paid flows in the client
NEXT_PUBLIC_BILLING_DISABLED=

```

Notes:

- A production server (`NODE_ENV=production`, a long-running `next start` or Docker process) runs the usage recovery job in-process, first 30 seconds after boot, with no external scheduler or `CRON_SECRET`. It checks every minute but queries the database only when work is due: when the oldest unsettled reservation turns stale (read from the database after each run), a minute after a settlement on that replica fails, and otherwise once an hour (work another replica left behind), so an idle server lets a scale-to-zero database such as Neon suspend. Each run recovers up to five interrupted usage reservations. `GET /api/cron/max-mode-meter-events` (the path predates prepaid Max Mode credits and is kept for existing schedulers) runs the same job manually or from an external scheduler (`Authorization: Bearer <CRON_SECRET>`, a random value of at least 32 characters; 503 while `CRON_SECRET` is unset): schedule it every minute where the server cannot run timers (serverless hosts; on Vercel, detected by its `VERCEL` variable, the server does not start the in-process jobs). Every replica runs the job, which is safe concurrently (also with the route): settlement re-reads each reservation under the per-user lock and skips a settled one. While recoveries fail, a run logs an error and sends the Sentry warning `Background job usage-and-meter reported failures` (tag `job`; extra `recoveryFailed`), at most once an hour per replica unless the count grows (errors a run throws are sent to Sentry as exceptions); the route answers 503 in the same case. A run still in progress after 15 minutes (a hung query) makes the later runs on that replica skip; it is reported with the Sentry warning `Background job usage-and-meter is stuck` (extra `runningForMs`), at most once an hour while it lasts. Alert on these warnings.
- Subscription deletion/ended-state webhooks update only the matching subscription ID, so delayed events cannot clear a replacement contract or recreate a deleted team's billing row. Subscription status synchronization and plan/cancel/resume writes compare the entitlement snapshot read before Stripe I/O, preserving a concurrently purchased contract. Subscription scans paginate to avoid missing older active contracts. Both seat synchronization and team plan changes hold the organization's billing lock through the Stripe quantity update. Seats are also synchronized when a team subscription becomes active, so members who joined while checkout was open are billed.
- IPv6 registration limits normalize compressed, expanded, and zero-padded addresses to one /64 key. IPv4-mapped IPv6 addresses use the native IPv4 key. Existing hashed signup-risk keys cannot be rewritten from hashes; historical rows recorded with the old IPv6 key may not match the corrected key.
- Ad submissions reserve a `review` campaign under the account lock before AI review. All submission attempts, including pending/rejected/failed reviews, count toward the ten submissions per rolling 24 hours; concurrent requests cannot exceed the cap. A failed review marks the campaign rejected and never enables payment. A process interrupted during review leaves an unpayable `review` row, counted until it leaves the 24-hour window.
- `usage_reservation` stores each request's original quota period, allowance, cap, and payer. Only finalized usage contributes to overage; pending estimates never get billed. Late settlements leave a replacement monthly/guest quota untouched and keep their original Stripe timestamp/customer. Keep all receipts for an open quota or meter period and for any period with unsettled requests; deleting individual receipts loses the allocation history and monthly billing totals.

- Chat exports fetch the full saved transcript. PDF prints its text in a temporary print-only view, independently of lazy message loading; it shows the same busy state as Markdown/JSON and reports a fetch failure instead of silently printing a partial conversation. Markdown formatting remains plain text in PDF, matching the text scope of Markdown export. Artifact live previews import React modules from `https://esm.sh`; `script-src` explicitly allows that origin because `srcDoc` previews inherit the parent CSP.
- All non-guest registrations, including Google / GitHub OAuth callbacks and direct ID-token sign-ins, require a major email provider or a restricted educational domain from `src/lib/email-domain-policy.ts`. Custom corporate and disposable domains outside that allowlist are rejected with `EMAIL_DOMAIN_NOT_ALLOWED`, as are forwarding-alias services such as DuckDuckGo Email Protection (`duck.com`). Gmail / Googlemail require Google sign-in, including when the address is supplied by GitHub. This gates new accounts and email changes (the new address must pass the same allowlist); existing accounts on a domain that has since left the allowlist, such as `duck.com`, keep signing in with a password, passkey, magic link, or Google / GitHub, and can change to an allowed address.
- Email registration rejects plus aliases, fragmented dots, and empty dot segments. These local-part restrictions do not apply to provider-verified OAuth identities. Gmail (`gmail.com`, `googlemail.com`) registers only through Google or GitHub (`EMAIL_USE_GOOGLE_OAUTH` for email sign-ups); a GitHub-provided Gmail address must also pass the alias rules (`EMAIL_ALIAS_NOT_ALLOWED`), since Gmail delivers every dot and +tag variant to one inbox. A failed Google/GitHub sign-in returns to the auth page with `?error=`, where the reason is shown. Letters followed by digits (e.g. `taro1990`) are an advisory verification signal, not an alias rejection. They are not rejected: they go through the signup Turnstile and mailbox-verification flows when configured, and `isRandomLookingLocalPart` feeds the batch sign-up score below.
- With email configured, a second email sign-up for a still-unverified address with a different password removes the stored password and its sessions, so verifying the mailbox never confirms a password set by someone else; that owner signs in through the verification link and sets a password with a password reset. A password reset signs out every session. Magic-link sign-in for an account with 2FA continues to the two-factor challenge. Guest accounts cannot change their email address.

- Batch sign-ups are limited per network (IPv6 by /64): at most 3 accounts per hour and 8 per day from one network, and 60 per day for school addresses (shared campus networks). The limit covers every non-guest sign-up path (email, magic link, OAuth) and is refused with `SIGNUP_RATE_LIMITED`. It uses the rate limiter above, so set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` on multi-instance deployments; the in-memory fallback is per instance. It needs a resolvable client IP (see `CLIENT_IP_HEADER` below); without one nothing is limited.

- A sign-up that looks like part of a batch (scripted client, a second or third account from one network, a random-looking address on top of another signal) is recorded in `signup_risk`. Its Free allowance is reduced (3M basic / 0.5M premium tokens instead of 10M / 2M) until a payment method is verified, which gives the normal verified allowance. Nothing is rejected. The account is told its Free allowance is limited and that verifying a payment method lifts it (in the usage alert and on the billing page), without saying why. Apply the `signup_risk` migration before deploying.
- Optional quota weights: `FLIXA_USAGE_WEIGHT_INPUT` (default **1**), `FLIXA_USAGE_WEIGHT_CACHE_READ` (**0.1**), `FLIXA_USAGE_WEIGHT_CACHE_WRITE` (**1.25**), and `FLIXA_USAGE_WEIGHT_OUTPUT` (**5**) weight the respective input/cache/output token counts before the model multiplier. The weighted sum is rounded up. Empty values are unset; parsing preserves `parseFloat` semantics (including numeric prefixes and zero), and invalid, negative or non-finite values use the defaults. Long-context pricing applies to each provider request independently, including each tool step; summed input across requests never triggers the premium. Team overage displays use the Pro included limit.
- Ad checkout persists a reservation before contacting Stripe, then rechecks campaign/session state under the fixed-slot lock before recording the result. Failed or uncertain creation retains the reservation until its 23-hour expiry so a retry uses the same Stripe idempotency key. An unpaid checkout never holds the fixed slot: only a running fixed campaign blocks new (or resumed) fixed checkouts, so several advertisers may be checking out at once and the first payment wins. Each account may attempt 10 ad checkouts per minute. Fixed-slot payment conflicts are rejected with a pending-refund marker before Stripe is called; webhook retries recover the same idempotent refund, and only successful refunds are marked complete. Stripe network calls run without holding the global ad transaction lock.

- Deni AI Ads: users submit text creatives at `/settings/ads`. The campaign list shows a loading indicator until the initial request finishes, and shows an error with retry instead of a false empty state if loading fails. Advertisers can filter all, active, rejected, or ended campaigns (including exhausted budgets and expired fixed placements), with three campaigns per page; unpaid approved campaigns remain visible under All. OpenRouter AI reviews the text and URL before Stripe checkout; a failed review never enables payment. Stripe's `checkout.session.completed` webhook activates paid campaigns; the advertiser's campaign list also verifies incomplete activations directly with Stripe, so a delayed webhook does not offer a second payment. To bound Stripe traffic, each list request verifies only the three newest unpaid checkouts, at most 10 times per minute per account; the others show as resumable, and resuming one confirms it with Stripe first. Set `OPENROUTER_API_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`, and apply the generated ads migration before enabling this feature. Prepaid CPM costs ¥200/1,000 views (¥1 per five unique views); CPC costs ¥30 per unique click; the single fixed chat slot costs ¥3,000 for 30 days. Budgets for CPM/CPC are ¥300–100,000, charged in advance. Stripe Checkout accepts promotion codes for ad payments; discounts reduce the amount charged, not the campaign's prepaid budget or fixed-slot duration. Signed-in free-tier users and anonymous guest sessions see ads (never paid users or the advertiser's own campaign). Anonymous guest views and clicks count as half a billable view/click (¥15 per guest CPC click); normal views count ¥1 per five and guest views count ¥1 per ten. Views are counted only when at least half of the ad is visible; one view/account/campaign/10 minutes and one click/account/campaign/day count for billing. Ads stop when budget is spent. The fixed slot takes priority over rotating campaigns. Deni AI Ads also appear beneath the start buttons in the public `/home` Hero (and its Japanese version). Visitors without a session are identified by a server-side HMAC of their client IP and counted at the same 0.5 view/click weight as anonymous guest sessions (¥1 per ten views; ¥15 per CPC click). The identity is per network (one IPv4 address, or one IPv6 /64, since a single subscriber controls a whole /64): repeat views from the same network/campaign within a ten-minute billing window and clicks within a daily billing window are deduplicated, including visitors sharing a network. Each network also bills at most 120 guest views per hour and 20 guest clicks per day across all campaigns, anonymous guest sessions included; beyond that, ads still display and open but are not billed. Delivery tokens bind to the hashed network; raw IPs are not stored in ad events or exposed in tokens. No account is created just to display an ad. Configure how the client IP is resolved (see [Client IP behind proxies](#client-ip-behind-proxies)) and block direct access to the app server to prevent IP spoofing and fraudulent billing. If no valid client IP can be resolved, visitors can still open ads via direct links, but those deliveries are not counted or billed. Signed-in free users and anonymous guest sessions use the existing account-bound view/click tracking; paid users see no Deni AI Ads. The chat start screen also shows a Deni AI ad below the composer. In conversations, a single Deni AI ad appears below the latest completed assistant answer (not on the empty new-chat screen or while a reply is streaming). The next ad is prefetched while the reply is in progress; if the request is still pending at completion, a compact loading state is shown until the ad arrives. Each completed answer requests a different eligible ad when available, otherwise reuses the previous one. Only the clearly labeled ad's "Learn more" button opens the advertiser's site. Titles and descriptions are displayed in at most two lines each; advertisers should put important information first. Ad event rows are used for deduplication; no third-party ad script is loaded. AI review blocks only clearly unsafe categories (e.g. fraud, impersonation, illegal content); ordinary comparative claims and vague slogans are allowed. It checks creative text and the URL, not the destination site's contents. Advertisers choose Japanese or English for the default title/description and may optionally add a title/description variant only in the other language; both versions are AI-reviewed, and the chat banner uses the viewer's app language with the default text as fallback. Existing campaigns without a recorded default language keep their previous language-variant behavior until edited. Advertisers also choose target languages (Japanese, English, or both; at least one): a campaign is delivered only to viewers whose app language is selected, and existing campaigns target both. Target languages can be changed from the campaign list without a new AI review. The single fixed slot is still shared across languages, so a fixed campaign targeting one language leaves viewers in the other language with rotating campaigns. Advertisers can edit their ad title, description, language variants, and HTTPS destination from the campaign list; changes are AI-reviewed before publication, and a rejected revision leaves the previously approved/live ad unchanged. Rejected unpaid ads can be corrected and reviewed in place. Pricing, budget, and fixed-slot dates cannot be changed through edits. Click tokens bind to the original destination so a pre-edit card never redirects to a different URL. Delivery tokens bill views and clicks for one hour; after that, a click on the same card still opens the advertiser's site but is not billed. Click-origin validation uses the public origin configured by `NEXT_PUBLIC_BETTER_AUTH_URL`, not the internal request host, so redirects work behind a reverse proxy; the proxy must preserve the browser's `Referer` and `Sec-Fetch-Site` headers. Review policy and refund handling before enabling external paid advertising.
- Remove old `NEXT_PUBLIC_ADSENSE_*` configuration from deployments; AdSense and `ads.txt` are no longer used.

- Empty optional vars are treated as unset (`emptyStringAsUndefined` in `src/env.ts`), which helps Docker / Dokploy builds that inject `""` for missing keys.
- Provider keys are capability switches: missing `ANTHROPIC_API_KEY` falls back to OpenRouter, missing `DENI_API_KEY` disables memory (extraction uses GPT-6 Luna on the Deni AI API), missing `EXA_API_KEY` disables web search, and missing Stripe keys disables billing.
- Guest sessions use only `gpt-6-luna` and have an allowance of 1M usage units ($0.50), spent by weighted tokens like a signed-in account's pool; it never resets. Guest prompts are also capped at about 32K estimated tokens (rejected with 413 before any usage is reserved: `guest_attachment_too_large` when the attachments push an otherwise short prompt over the cap, `guest_prompt_too_long` otherwise). The cap counts the text plus each image at 2,000 tokens (providers bill images by their resized resolution) and each PDF at one token per 3 bytes of the file, at least 25,000, whether attached by URL or inline; a PDF is billed by its pages, so its size is the bound. Inline files are measured by their decoded data and URL files by the copy downloaded before the check, and a PDF whose size is unknown counts as the 10 MB maximum, so a guest prompt fits one PDF of up to roughly 90 KB. Tool results from earlier turns are resent shortened to 2,000 characters. Output is capped at 16,384 tokens per step with reasoning effort capped at medium (higher efforts could spend the whole cap on hidden reasoning; an effort the model does not support falls back to the model's preferred one first, then is capped), the tool loop at 8 steps, and automatic memory saving is skipped.
- Attachment storage: with the four `R2_*` settings set, uploads are stored as private objects in the Cloudflare R2 bucket and recorded in the `attachment` table (apply the generated migration first). Create the bucket without a public `r2.dev` URL or custom domain, and an R2 API token (Object Read & Write, limited to that bucket); `R2_ACCOUNT_ID` is the Cloudflare account id. Objects are stored as `attachments/<attachment id>` and `exports/<export id>`, read through presigned URLs of `https://<account id>.r2.cloudflarestorage.com/<bucket>/...` (signed locally, no request to R2), and deleted one request per object. The upload route returns the app URL `/api/attachments/<id>`, never a storage URL. That route requires a session and answers 404 unless the signed-in user owns the stored file (so another user's id is indistinguishable from a missing one), then redirects with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` to a signed URL valid for 10 minutes. Chat requests may carry the app URL relative or absolute on `NEXT_PUBLIC_BETTER_AUTH_URL`. The chat server looks each id up before validating or downloading anything: a request referencing another user's file is rejected with 400 (`Invalid or oversized attachment`), a missing, unfinished or deleting file of the user's own reaches the model as an "unavailable" notice (so a chat whose file is gone keeps working), and the user's own stored files get a 5-minute signed URL that only the server uses: it downloads images and PDFs and inlines text files itself, so model providers receive the file bytes or text, never a signed or app URL (an app attachment URL outside a user's file part is replaced by the notice for the same reason). The saved chat keeps the stable `/api/attachments/<id>` URL. Data exports use 15-minute URLs (`ATTACHMENT_*_URL_TTL_SECONDS` in `src/lib/upload.ts`). Each account has an attachment storage quota counting stored files plus uploads in progress: guest 20 MB, Free 100 MB, Go 200 MB, Plus 500 MB, Pro 1 GB; team members follow their team plan (Pro Team 1 GB). Sizes are binary (1 MB = 1 MiB). The quota is reserved under a per-user PostgreSQL advisory lock before the upload starts, so parallel uploads cannot pass it; an upload past it is rejected with 413 (`reason: "storage_quota_exceeded"`). A failed upload gives its reservation back once its file is deleted again (an upload can fail after the file was stored); if that delete fails too, the reservation is marked for deletion instead, which frees the quota and leaves the file to the storage cleanup below. A reservation left by an upload interrupted for over an hour is dropped by the storage cleanup below or on the owner's next upload. Each file's key derives from its attachment id, so dropping a reservation also deletes a file whose storage key was never recorded. Sending a message ties its uploads to the chat (the first chat that sends a file keeps it). Deleting the chat, or all chats, marks those rows `deleting` in the same transaction (except a file another chat of the same owner still references by its app URL, for example a re-imported copy of the chat: it moves to the most recently updated such chat and is kept; the lookup reads each of the owner's other chats once), which gives the quota back at once; once it commits, the files are deleted and then the rows of the files that are gone. A file R2 fails to delete keeps its marked row (never served or sent to a model again) for the cleanup to retry. Uploads never tied to a chat (removed from the composer, never sent, or whose chat was deleted another way) are deleted with their files once they are 24 hours old. Deleting an account (including a guest removed after linking an account) deletes its stored files once the user row is gone, and `pnpm run tools:purge-anonymous` deletes the stored files of the guests it purges; both are best effort, since the rows are gone with the user (failures are logged; the purge tool lists them and exits 1). When storage is configured but an upload fails, the route returns 502 instead of falling back to an inline data URL, which would bypass the quota. Settings → Import replaces a file part whose app attachment URL is not a file of the importing user (another account's export of this deployment, or a deleted file) with an "[An attached file could not be imported.]" notice, saved in the chat in the importing user's language (the request's locale), and the import page shows how many files were replaced; kept as is, it would make every request of the imported chat fail with 400. A file part without a URL (for example from an AI SDK v4 transcript) is left out. Settings → Billing shows the storage used. The chat server only fetches text attachments from presigned URLs of the configured bucket; any other URL in a text file part reads as "could not be read".
- Attachment storage cleanup: a production server runs it in-process every hour, starting 2 minutes after boot (a no-op without R2 storage configured). `GET /api/cron/storage-cleanup` runs it manually or from an external scheduler (`Authorization: Bearer <CRON_SECRET>`; disabled with 503 while `CRON_SECRET` is unset); schedule it hourly where the server cannot run timers (serverless hosts). Each run marks for deletion up to 500 uploads still pending after an hour and up to 500 files untied from any chat for 24 hours (oldest first), then deletes the files and rows of up to 500 marked rows, including ones a failed chat deletion left behind. The route returns `{ marked, deleted, failed }` and answers 503 while files fail to delete (their rows stay for the next run); an in-process run then logs an error and sends the Sentry warning `Background job storage-cleanup reported failures` (extra `attachmentsFailed`, `exportsFailed`): alert on repeated warnings. A run still in progress after 3 hours is reported with the Sentry warning `Background job storage-cleanup is stuck` (extra `runningForMs`; at most once an hour), since later runs on that replica skip until it ends. Call the route more often if the backlog grows. Every replica runs the cleanup, which is safe concurrently: marking re-checks each row's expiry in the update, marked rows are never unmarked, a row is deleted only after its file, and deleting a file or row twice changes nothing. The same run also deletes expired data exports (see Account data export below) and reports them as `exports: { deleted, failed }`.
- Account data export (Settings → Account → Download your data): with R2 storage configured, the export is built in the background and stored as a private file (apply the generated `account_export` migration first). A request (at most one per minute per user, logged as "Account data exported" in the security activity) creates a `pending` row and schedules the job with Next.js `after()`, which runs once the response is sent: a Node.js server (`next start`, Docker) also waits for it on graceful shutdown, while a serverless host must let it finish within the tRPC route's maximum duration. While an export is pending, another request returns it instead of starting a second. The job builds the same JSON as before (chat transcripts read in pages), uploads it as `deni-ai-export-YYYY-MM-DD.json` (private, `application/json`, served as a download, under `exports/<export id>`) and marks it ready for 7 days; a failure marks it failed (the reason is logged, not shown). A row still pending after 30 minutes lost its job (restart, crash, time limit): it reads as failed and can be retried. Settings polls every 4 seconds while an export is pending, then shows its size, expiry and a Download button; each download asks the server for a 15-minute signed URL, issued only to the owner of a ready, unexpired export. A new ready export replaces the user's older ones (their files are deleted). Export files do not count toward the attachment storage quota. The hourly storage cleanup deletes expired exports, and failed or abandoned ones older than 7 days, with their files (up to 500 of each per run); deleting an account, or purging guests with `pnpm run tools:purge-anonymous`, deletes its export files too. No email is sent when an export is ready. Without R2 storage (local development) the export is built in the request and downloaded directly, as before, and Settings ignores export rows left from a time storage was configured.
- Attachment storage move from UploadThing to R2 (deployments that stored files in UploadThing): the database keeps each file's `storage_key`, and `pnpm run tools:migrate-uploadthing-to-r2` copies each file to R2 under that same key, so no row changes. It covers ready attachments and ready, unexpired data exports; it only reads the database and never deletes anything. (1) Create the bucket and API token above and put the `R2_*` settings in `.env.production` next to `DATABASE_URL` and the old `UPLOADTHING_TOKEN`; (2) run the tool (dry run: how many files are left to copy), then with `--apply`, while the UploadThing build still serves; (3) deploy the R2 build with the `R2_*` settings; (4) run `--apply` again for files uploaded in between (until then they read as unavailable), and repeat until a dry run reports none left to copy; (5) verify: open an old chat with an image (it loads through `/api/attachments/<id>`), continue it, upload a new file, and download a data export; (6) run `pnpm run tools:audit-uploadthing-storage` (read only) to see what the UploadThing files left uncopied are: the copy tool only covers files the database records, so uploads from before storage became private (still public URLs in old chats if they never got an attachment row), retired project files and files of chats or accounts deleted back then stay in UploadThing; move the files old chats still reference with `pnpm run tools:migrate-legacy-chat-files` (dry run, then `--apply`; it records attachment rows, which count against their owners' quotas, and rewrites those chats to app URLs), and repeat until the audit lists no public chat URLs; (7) remove `UPLOADTHING_TOKEN`, and delete the UploadThing app's files once you no longer need them for a rollback (files the audit lists under public chat URLs are still shown in those chats). Uploads interrupted under UploadThing (pending rows without a key) leave their UploadThing files behind; the storage cleanup drops their rows as usual.
- Each web `search` tool call consumes 10,000 usage units, guests included. Failed searches are refunded. Browse does not consume a separate search charge. Image and video generation have been removed.
- Browse validates every redirect and pins direct HTTP(S) connections to validated public DNS answers. Direct and reader responses are limited to 2,000,000 bytes while streaming. The direct path uses Node HTTP(S), so it requires the Node.js runtime.
- API key creation and device authorization share an account-row lock inside a PostgreSQL transaction; the five-key cap applies across instances. No schema migration is needed for this lock.
- Usage reservations and settlements serialize on the account row. Final quota reconciliation, the original payer's ledger, the receipt, and the Max Mode credit spend commit together. Member caps include outstanding reservations at admission and cap actual overage at settlement. Token counters use PostgreSQL `bigint` so Max Mode can exceed 2.1 billion tokens without integer overflow. Apply the generated migration before deploying these changes.
- Stopped or replaced chat generations still settle their own receipt. Completed provider usage is persisted, and active requests refresh their receipt every 30 seconds. Providers report usage when a model call ends, so a stop while a step runs its tools keeps that call's reported usage. Once output has streamed, a call the provider accepted but that was cut off before it ended by Stop, replacement, disconnect or an upstream error (including while it is still reading the prompt or reasoning before its first streamed part) is billed at an estimate: its prompt plus the output streamed so far. The prompt is the larger of its text and the input the provider reported for the last call whose prompt it starts with (attachments included), plus the messages added since; that report comes from an earlier call of the same request, or from the first call of a recent request for the same chat and model (within 5 minutes, on the same instance) whose system prompt, tools and messages this prompt still starts with. The part of the prompt the provider last reported reading from cache, or the reported prompt it was just sent, is billed at the cache-read weight and the rest at full input weight. A first call with no earlier report counts its attachments at nothing. A call counts as accepted once the provider opens its stream; a call the provider rejects (for example 429, 503 or a context-window error, which throw before that, on every retry) is not billed, including when Stop lands while the SDK waits to retry it, and a generation stopped before any output is still fully refunded. The token reservation counts each URL-referenced attachment at a floor (2,000 tokens per image, 25,000 per PDF) because those files are downloaded only after admission; the floors are reserved only and never billed on their own. The usage recovery job (in-process when work is due, or the authenticated retry route) recovers receipts silent for 15 minutes using observed usage, returning the unused estimate. It runs even when Stripe is disabled; where it cannot run in-process, schedule the route then too. Quota-reset rewards do not erase accrued charges or a team ledger.
- Model availability: a production server (`NODE_ENV=production`) probes the models in-process every 5 minutes, starting 10 seconds after boot. Each probe sends a 1-token request to `gpt-6-luna` and `gpt-5.6-luna` (both Deni AI API), `gemini-3.8-flash` (OpenRouter/Google) and `claude-haiku-5.5` (OpenRouter/Anthropic) and keeps the latest result in the server's memory (no database; apply the migration that drops the old `model_health` table). `GET /api/status/models` returns the public status and the model picker shows it: a probed model shows its own result, and any other model shows the worst result among the probes on its route. With more than one replica every replica probes on its own and serves its own results (scheduling the route does not stop them). Serverless hosts cannot run the in-process timer reliably; `GET /api/cron/model-health` (with `Authorization: Bearer <CRON_SECRET>`) probes and refreshes the results of the instance that serves it, so status there can be missing until an instance has probed. The probes consume a few tokens per run and the cron route returns 200 even when a model is unavailable.
- Regenerating an older answer branches at the selected answer and restarts subsequent turns. Existing alternatives for that answer remain available in the current chat pane. If a regeneration fails or is stopped before the new answer starts, the original answer and the turns after it are kept, both on screen and in the saved chat.
- Stop also cancels a request whose generation has not started yet: right after registering the generation, the server checks whether a stop for that chat arrived after the request did, and if so saves the question without generating or charging an answer. The stop route remembers the stop in memory for the same instance and records its arrival time on the chat row (`chats.stop_requested_at`, apply the migration first) before looking for a generation to stop, so a request registering on another instance either sees the stop or is stopped by it. Arrival times come from each instance's clock, so keep instance clocks synchronized (NTP). A client disconnect is not a stop: the generation, including attachment downloads before it, continues in the background and the client picks up the answer when it returns.
- Pending-answer recovery merges the latest server message window into loaded history using message IDs, so loading older messages does not prevent recovery. A snapshot for an older turn does not replace a newer local question.
- Prompts supplied through `/new/<prompt>` or `?message=` prefill the composer for manual submission. They preserve literal percent escapes after normal URL decoding; they are never decoded a second time.
- Organization removal/role-change audit events are written only by better-auth's server hooks. The auth route provides the authenticated actor through request-local storage; direct server callers must use `withTeamAuditActor`. Clients cannot submit their own audit events.
- Joining an organization cancels a personal subscription only when membership and a live licensed team subscription are verified. Free/unpaid teams or Stripe verification errors leave the personal plan untouched. Invitation links (`/settings/team?invitationId=…`) only highlight the invitation; joining always takes an Accept click and a confirmation that warns when the personal subscription would be canceled.
- Team audit log entries outlive their actor's account: `team_usage_audit_log.actor_user_id` is nullable with `ON DELETE SET NULL`, and the audit views show such entries as a deleted user.
- Team billing identity is organization-scoped, serialized with a PostgreSQL advisory transaction lock. Existing per-admin copies are retained for ledger history but ignored for entitlement; subscription synchronization/revocation updates all copies.
- A team billing row belongs to its organization, not to a person: `billing.user_id` only names its billing contact and is nullable with `ON DELETE SET NULL` (`billing_organization_idx` serves the per-organization lookup). Personal rows always name their user: every account deletion path deletes them right before the user row (a failure there is logged and orphans the row rather than failing a deletion that has already removed the sessions and sign-in accounts). When the contact leaves the team, is removed, or deletes their account, the row keeps billing the team with `user_id` NULL and is reused, never duplicated; self-service account deletion clears the contact itself before anything in Stripe or sign-in data changes. Team Stripe webhooks are applied by organization even when no existing user can be credited, and their audit entries then show a deleted user. When any member leaves, is removed, or deletes their account, the team's Stripe customer email is changed (best-effort) to the email of the team's earliest current owner only while it is still that member's address; any other address, such as an accounts inbox an owner set in the billing portal, is left alone, whoever created the customer.
  Rollout: apply the generated migration first, then deploy the code, as for the attachment and export tables in the same migration. Code from before this change keeps working on the new schema: an account it deletes in between keeps its personal billing row with `user_id` NULL instead of the old cascade deleting it (such a row is never matched by a user and counts toward no card limit), and a team row whose contact it deletes keeps billing the team instead of being deleted. Do not deploy the code first: on the old schema, chat deletion, uploads and data export fail on the missing tables, and a team's billing contact cannot delete their account.
  - Optionally, once the new code is live, delete the personal rows orphaned in between: `DELETE FROM billing WHERE organization_id IS NULL AND user_id IS NULL;`
  - Optionally, after migrating, clear contacts who left their team before this change: `UPDATE billing SET user_id = NULL WHERE organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM member WHERE member.organization_id = billing.organization_id AND member.user_id = billing.user_id);`
- Personal/team plan changes use Stripe `error_if_incomplete`: a failed upgrade payment must not grant the requested tier. Requests requiring further payment authentication are rejected instead of applying an unpaid upgrade. Both are confirmed in a dialog showing Stripe's invoice preview first (`estimatePlanChange` / `estimateTeamPlanChange`, the team one for every seat), and cancelling either subscription asks for confirmation.
- Operator/blog administrator email allowlists require verified, non-anonymous accounts even when email delivery is disabled. Configure a supported mailbox-verification path before relying on these administrator roles.
- Card verification validates the intent's user, customer, and purpose. The shared card fingerprint is locked and its eligibility plus verification claim committed together before external follow-up, preventing simultaneous free-tier claims above the card limit. Removing a card keeps its fingerprint and sets `billing.card_removed_at`, so the account loses the verified-free boost but the card's slot stays taken. Cards cannot be removed while Stripe still has a live subscription (including one canceling at period end or the Max Mode meter subscription) or draft/unpaid invoices.
- Purchases are recorded only by the Stripe webhook and the live-subscription sync; there is no client-side checkout confirmation. Every plan is a subscription, so checkout refuses a non-recurring Stripe price and any account whose subscription is still active or set to cancel. A stored open checkout session is reused only for the same plan, price, and flash offer state; otherwise it is expired before a new one is created.
- Better Auth self-service organization leave is audited server-side and reconciles licensed seats after successful authorization, just like member removal.
- Device approval requires the configured public origin and `application/json`; initiate/poll remain available to extension clients without a browser Origin. Reverse proxies must preserve the browser's Origin header.
- `pnpm test` includes both `tools/*.test.ts` and `src/**/*.test.ts`.
- When adding or changing supported models, update `src/lib/constants.ts`.
- `OPENROUTER_API_KEY` routes OpenAI-family and other OpenRouter models when voids mode is off. It also serves as the Anthropic fallback when `ANTHROPIC_API_KEY` is absent.
- Optional voids.top mode: set `VOIDS_MODE=true` (or `1`) and provide **`VOIDS_API_KEY`** to send OpenAI and Anthropic traffic through the OpenAI-compatible voids.top gateway. Without the key, normal provider routing is used. Optional `VOIDS_BASE_URL` (default `https://capi.voids.top/v2`). When `VOIDS_MODE` is off, OpenAI uses OpenRouter and Anthropic uses its native key when present, otherwise OpenRouter.
- Optional Deni AI API: set **`DENI_API_KEY`** (and optionally **`DENI_API_BASE_URL`**, default `https://api.deniai.app/v1`, an OpenAI-compatible Chat Completions endpoint) to expose OpenAI models, including GPT-6 Luna. OpenAI models on this route are sent as `openai/<id>` (e.g. `openai/gpt-6-sol`) and do not offer Pro or Fast mode. A missing key hides those models.
- Operator administration: set `ADMIN_EMAILS` to a comma-separated list of account emails that can grant usage reset credits from **Settings → Billing** and receive dispute alerts. The address is read only on the server. The former name `AFFILIATE_ADMIN_EMAILS` is still read when `ADMIN_EMAILS` is unset; rename it when convenient.
- Blog administration: set `BLOG_ADMIN_EMAILS` to a comma-separated list of account emails that can write and publish posts at `/settings/blog`. If omitted, `ADMIN_EMAILS` is used.
- Operator email domains: set `ADMIN_EMAIL_DOMAINS` to a comma-separated list of domains (for example `deniai.app`). Addresses on these domains may sign up even though the domain is not on the sign-up allowlist, and accounts with a verified email there can grant reset credits and manage the blog, in addition to `ADMIN_EMAILS` / `BLOG_ADMIN_EMAILS`. Dispute alerts still go only to the listed emails.
- **Email (Cloudflare Email Sending):** requires a Workers Paid plan and the sending domain (e.g. `deniai.app`) onboarded under **Email Service → Email Sending** in the Cloudflare dashboard (DNS/SPF/DKIM managed there). Create an API token with **Email Sending: Edit**, then set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. From address defaults to `Deni AI <noreply@deniai.app>` (`EMAIL_FROM` in `src/lib/constants.ts`). When either env var is missing, magic link / verification / invite emails are disabled, and so is changing an account's email address. With email configured, a verified account changes its email in two steps: the current address approves the request, then the new address receives a verification link, and the email updates only after that link is opened.

#### Generate `BETTER_AUTH_SECRET`

The secret must be **at least 32 characters** (Zod `min(32)`):

```bash
# 64 hex chars
pnpx auth secret

# or
openssl rand -hex 32
```

Keep a deployment's secret once it is in use: changing it signs every user out and makes data encrypted with the old secret unreadable. A new deployment with its own database (for example a canary) should get its own secret.

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
# Production (.env):
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

| Command                                | Description                          |
| -------------------------------------- | ------------------------------------ |
| `pnpm dev`                             | Start the Vite dev server            |
| `pnpm run build`                       | Production build (`.output/`)        |
| `pnpm start`                           | Start production server              |
| `pnpm run lint`                        | oxlint                               |
| `pnpm run lint:fix`                    | oxlint with auto-fix                 |
| `pnpm run format`                      | Format with oxfmt                    |
| `pnpm run typecheck`                   | TypeScript check (`tsc --noEmit`)    |
| `pnpm run db:generate`                 | Generate Drizzle migrations          |
| `pnpm run db:migrate`                  | Migrate using `.env`                 |
| `pnpm run db:migrate:dev`              | Migrate using `.env.local`           |
| `pnpm run db:push`                     | Push schema (dev)                    |
| `pnpm run auth:generate`               | Regenerate better-auth schema        |
| `pnpm run disposable:refresh`          | Refresh disposable-email domain list |
| `pnpm run tools:codename`              | Generate version codenames           |
| `pnpm run tools:update-types`          | Add missing Lucide type exports      |
| `pnpm run tools:commit`                | AI-assisted conventional commits     |
| `pnpm run tools:register-oauth-client` | Register an OAuth client (Deni Run)  |
| `pnpm run doctor`                      | Run react-doctor diagnostics         |
| `pnpm test`                            | Run local regression tests (Vitest)  |

TypeScript scripts run through `tsx`. Unlike Bun, Node.js does not automatically load
root environment files: the package scripts explicitly load `.env.local` when appropriate,
and production migrations use `.env`. For ad-hoc scripts, use
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
   - `charge.refunded`
   - `payment_intent.succeeded` (Max Mode credit auto top-up)
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

Optional flash offer coupon: `STRIPE_FLASH_OFFER_COUPON_ID`. The coupon discounts yearly plans for accounts that have never paid, in one of two modes set by `FLASH_OFFER_SPOTS` in `src/lib/billing-offers.ts`:

- **Spots** (a number, currently 2): every never-paid account gets the offer until the coupon's `times_redeemed` in Stripe reaches that number, then it ends for everyone. The billing page banner, the plan cards and a dismissible strip at the top of the app show the spots left instead of a countdown. Each completed checkout with the coupon (subscription or one-time) uses one spot. The count is checked when checkout opens, so a buyer who opened checkout before the last spot was taken can still finish with the discount.
- **Timers** (`null`): for 24 hours after a user first opens billing, the billing page shows the offer with a countdown. Verifying a card grants a one-time 48-hour offer from that moment (tracked by `billing.card_offer_granted_at`, so removing and re-verifying a card does not grant another), and users with an active offer who have verified a card also see the strip.

Without the coupon (or if it is invalid), no offer is shown.

Dispute handling is automatic when those extra webhook events are enabled. On `charge.dispute.created` the app emails admins and cancels the related subscription (immediately for fraud, otherwise at period end). Evidence is not submitted automatically; contest from the Stripe Dashboard if needed. On `radar.early_fraud_warning.created` it refunds as fraud only when the payment is still actionable, 3D Secure did not authenticate it, and the account has no post-payment service use. Alerts go to `ADMIN_EMAILS` / `BLOG_ADMIN_EMAILS` when Cloudflare email is configured.

Checkout and card verification always request 3D Secure (`request_three_d_secure: any`), matching the Radar policy that also blocks `:card_3d_secure_support: = 'not_supported'`. A verified card unlocks the chat model catalog for free accounts except paid-only models (subject to the verified-free token limits); the Go plan unlocks the same catalog, has no ads, and includes Max Mode credits but not Pro mode. Guests remain limited to the guest model. Pro-only models (the GPT-5.6 series) need Pro, including team plans; Plus unlocks every other model. Signed-in free users without a verified card see a reminder at the bottom of the model selector's right panel; it stays visible while scrolling the model list and is hidden for verified-card users, paid users, guests, and deployments with billing disabled.

Keep a Terms of Service URL in Stripe public details (`https://deniai.app/legal/terms`). Optional: turn on [Smart Disputes](https://dashboard.stripe.com/settings/disputes) if you want Stripe to help assemble network evidence.

Anonymous guest sessions cannot use billing endpoints or create Stripe customers; sign in to a permanent account first. Personal and team billing fetch profiles and search/create Stripe customers before opening a database transaction. Account/organization idempotency keys prevent concurrent duplicate customer creation; short advisory-lock transactions recheck and insert billing rows. Customer searches use account/organization metadata rather than email and fail closed on search errors. Creation retries are idempotent. On account deletion, team owners must delete their team or transfer ownership first (checked again server-side before Stripe/customer deletion). Other members, including a former owner or the team's billing contact, can delete their account while the team keeps paying; the team's subscription, customer, and billing row are left to the organization. Active personal subscriptions block deletion. For a prepaid subscription already scheduled to end, users can wait and return after it ends (no automatic account deletion), or delete now and forfeit remaining access without a refund. A subscription carrying metered usage must finish its scheduled period and final billing first. Unsettled requests and draft/unpaid invoices also block deletion. The hook rechecks pending usage under the account lock and freezes new usage before canceling prepaid subscriptions without proration or invoicing and removing personal Stripe customers. The personal billing row is deleted explicitly right before the user row on every deletion path (including guest cleanup), since it may not outlive its user. A failed deletion can be retried. Team customers remain owned by their organization. Existing duplicate customers are not automatically merged; check their subscriptions and payment methods before manually reconciling them.

Plan prices are resolved by Stripe `lookup_key` matching `src/lib/billing.ts` (`go_monthly`, `plus_monthly`, `pro_team_yearly`, and so on). The Go plan is monthly only: create a recurring monthly price with lookup key `go_monthly` ($1/month). Team plans (`pro_team_monthly`, `pro_team_yearly`) are licensed per seat. The Max plans (`max_*`, `max_team_*`) were removed; their lookup keys no longer map to a plan, so a remaining Max subscription is treated as Free. Missing team lookup keys are skipped in the team billing UI; checkout still errors if that specific price is missing.

Plan prices on the billing and team billing pages are shown in yen (JPY) to visitors whose Cloudflare `CF-IPCountry` header is `JP`, and in US dollars to everyone else (including deployments not behind Cloudflare). The yen amount comes from the price's JPY currency option, so add a JPY entry under each plan price's **Currency options** in Stripe (multi-currency prices); a price without one keeps showing USD. Checkout charges a customer in Japan that same JPY amount. An amount-off flash offer coupon needs a JPY currency option too, or it is not applied to the yen price shown.

### Max Mode credits

Max Mode keeps a paid plan (Go, Plus, Pro, or a team plan) working past its monthly pool by spending **prepaid credits**. One credit is $1 of usage, the same rate as the pool: 2M usage units (`MAX_MODE_CREDIT_UNITS` in `src/lib/max-mode-credits.ts`). Personal credits belong to the user; team credits belong to the organization and are shared by every member, within the per-member limits (in usage units past the pool) the team owner or admins set. Credits are spent only from an active plan, so they wait unused while a plan is past due, canceled, or downgraded to Free.

- **Buying:** Settings → Billing (personal) and the team settings page (owners and admins) offer $5 / $10 / $25 / $50 packs or a custom whole amount from 5 to 500 credits. Each purchase is a Stripe-hosted one-time Checkout (`mode: payment`, USD with adaptive pricing, 3D Secure requested, `metadata.purpose = "max_mode_credits"`). `checkout.session.completed` records one lot per payment intent (`max_mode_credit_lot`, unique `stripe_payment_intent_id`, so a replayed event grants nothing twice) and turns Max Mode on. No Stripe product or price needs to be created.
- **Expiry:** every lot expires **180 days** after purchase. Usage past the pool spends the lots that expire first. Expired lots stay listed (struck through) and are never refunded.
- **Spending:** a request may only go past the pool when Max Mode is on and the credits left cover its share past the pool (a member cap still bounds the period's overage). A chat request may spend in total what the pool had left when it started plus those credits: once its usage (finished steps plus the output streamed so far) reaches that, no further tool step runs and a streaming step stops like a user stop, keeping and billing its output. The reservation only holds an estimate (the prompt plus 1,024 tokens), so without this a long tool loop could run far past the pool. At settlement the overage is taken from the lots under row locks in the same transaction as the quota and ledger, so team members settling at once cannot spend one credit twice; the reservation's `max_mode_amount` records what was spent. Overage beyond the credits left (an estimate that ran over) is not charged, and the next request is refused.
- **Auto top-up:** owners can buy a fixed amount (5–500 credits, at least the threshold) automatically when the balance falls below a threshold (1–100 credits). It runs after a settlement that spent credits, as an off-session PaymentIntent with `metadata.autoTopUp = "true"` on the card saved at a credit checkout ("Save this card for auto top-up", `setup_future_usage: off_session`), else the plan subscription's default card, else the customer's default card. One top-up per owner runs at a time and at most once a minute. A charge that fails or needs authentication turns auto top-up off and shows the error until it is re-enabled. `payment_intent.succeeded` grants the same lot idempotently in case the direct response was lost.
- **Reversals:** `charge.refunded` and `charge.dispute.created` take back what is left of the lot that charge paid for; `charge.dispute.closed` in our favor restores it.
- Enable the webhook events `payment_intent.succeeded` and `charge.refunded` in addition to the ones listed above.

Credits are prepaid means of payment valid for at most 180 days (under six months), which keeps them outside the issuer obligations of Japan's Payment Services Act for prepaid payment instruments; do not extend the validity without reviewing that.

Earlier releases billed Max Mode overage through Stripe Billing Meters. No account used it, so `migrations/0071_max_mode_credits.sql` drops the meter queue (`max_mode_meter_event`) and the metered columns of `billing`; existing Max Mode switches stay, without credits.

### Customer Portal

Personal and team billing settings open the Stripe Customer Portal. Plan and seat changes must go through the app (`changePlan` / `changeTeamPlan`): it invoices prorations immediately, rejects incomplete payments, updates subscription metadata, and keeps team seats equal to the member count. The portal must therefore **not** allow subscription updates (switching plans or changing quantities).

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

## Combined usage: Deni AI Chat, Flixa, and Deni Run

One Deni AI subscription covers all three products, and they spend **one monthly
pool** per plan (`src/lib/usage-pool.ts`): Free $10, Go $30, Plus $100, Pro $200
(verified Free $15, flagged Free $2; guests have their own 1M-unit allowance that never resets).
The pool is counted in usage units, 1M units = $0.50:

- **Deni AI Chat and Flixa** spend weighted tokens, one unit each (token weights times the model's
  usage tier). Usage is **not split into basic and premium**: every request is recorded
  on the `basic` row of `usage_quota` (`SHARED_USAGE_CATEGORY`), whose limit is what the
  pool leaves after Deni Run (and any `premium` row from before the change), so a
  request is refused once the pool as a whole is spent. Max Mode spends prepaid credits
  for usage past the pool (see Max Mode credits), and team Max Mode has one member cap
  (the basic one). Each settled
  request also adds to `product_usage` (`product` = `chat` or `flixa`), which splits the
  quota between the two products. flixa-backend uses the same pool and writes its rows
  with raw SQL, so apply this migration before deploying it.
- **Deni Run** spends its provider cost, recorded in `product_usage` with `product` =
  `run` (`metric` = `model` / `browser` / `computer`, in micro-dollars = 2 units each).

The pool resets at the start of each UTC month; reset credits clear the chat/Flixa rows,
not Deni Run's spend. **Settings → Billing**, the settings sidebar, and the account
menu show the pool as one bar colored by product (Deni AI Chat, Flixa, Deni Run), in
percentages only.

Quota rows, reservations, and the chat/Flixa `product_usage` rows store `unit = 'units'`.
Before the switch they stored `'tokens'` (guests: `'requests'`); a row in an old unit
counts as empty and is reset on its next write. Switching an existing deployment:

1. Apply the migration (`pnpm run db:migrate`). It deletes every `usage_quota` row
   (guest allowances included), so everyone's usage for the current period starts
   over, and moves `usage_reservation` to `'units'`. Earlier `product_usage` rows keep
   their old unit as history.
2. Deploy Deni AI and flixa-backend together right after it.

Deni Run signs users in with Deni AI through the better-auth OAuth provider plugin
(`/api/auth/oauth2/*`; login page `/oauth/authorize`, consent page `/oauth/consent`; guest
accounts are refused). To connect a Deni Run deployment:

1. Apply the migration (OAuth provider and `product_usage` tables).
2. Register the client: `pnpm run tools:register-oauth-client --name="Deni Run"
   --redirect-uri=https://run.deniai.app/api/auth/callback/deni-ai` (load the target
   environment, e.g. `pnpm exec tsx --env-file=.env tools/register-oauth-client.ts ...` for
   production). It skips the consent screen and prints the client id and secret once.
3. Set `DENI_RUN_OAUTH_CLIENT_ID` here, and `DENI_AI_CLIENT_ID` / `DENI_AI_CLIENT_SECRET` in
   Deni Run.
4. Set the same random `DENI_RUN_SERVICE_SECRET` in both apps. Deni Run then calls
   `GET /api/integrations/deni-run/usage?userId=<Deni AI user id>` before work and
   `POST /api/integrations/deni-run/usage` with `{ userId, metric, costUsd }` after it
   (`Authorization: Bearer <DENI_RUN_SERVICE_SECRET>`).

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
| **product-usage**     | Monthly usage per product (Chat, Flixa, Run)  |
| **oauth-provider**    | OAuth provider clients, tokens, consents      |
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
4. Deploy (build uses `pnpm run build`; Nitro detects Vercel and emits its output format)
5. Serverless functions do not run the in-process background jobs reliably (on Vercel, detected by its `VERCEL` system variable, the server does not start the usage/meter and storage jobs, so a suspended function cannot leave a billing row lock held): set `CRON_SECRET` and schedule `GET /api/cron/max-mode-meter-events` every minute, `GET /api/cron/storage-cleanup` hourly and, optionally, `GET /api/cron/model-health` every 5 minutes (it refreshes only the instance that serves it) (for example with Vercel Cron Jobs, which send `Authorization: Bearer <CRON_SECRET>`)

### Docker / Dokploy

A multi-stage `Dockerfile` is included for self-hosting (e.g. Dokploy):

- **Install:** pnpm 12.8.1 (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), with a frozen lockfile.
- **Build:** Node 26 runs `vite build`, which writes the Nitro Node.js server to `.output/` (server bundle, traced `node_modules`, and public assets). The build does not typecheck — run `pnpm run typecheck` locally or in CI.
- Dependencies are installed in the build stage itself, so `node_modules` is an ordinary cached layer (reused while `pnpm-lock.yaml` is unchanged).
- **Run:** Node 26 runs `node .output/server/index.mjs` on port **3000** (`PORT`; bind address `HOST`)
- **Background jobs:** the server itself runs usage recovery when it is due (at least hourly), the storage cleanup every hour and the model health probes every 5 minutes; no cron or `CRON_SECRET` is needed (see the notes in step 3 of Getting Started)
- `NEXT_PUBLIC_*` values must be present at **build time** (inlined into the client bundle)
- Server secrets are read at runtime from the container environment (validated by `@t3-oss/env-core` in `src/env.ts`); optional provider keys can be omitted and disable their features

Dokploy application settings (typical):

| Setting         | Value        |
| --------------- | ------------ |
| Build type      | Dockerfile   |
| Dockerfile path | `Dockerfile` |
| Context         | `.`          |
| Port            | `3000`       |
| Build cache     | enabled      |

Put the same keys as production `.env` in the service **Environment** tab. Pass only the public `NEXT_PUBLIC_*` values (and optionally `SENTRY_ORG` / `SENTRY_PROJECT`) as **build-time** arguments: the build reads no server secrets, and build arguments stay in the build cache and image history. To upload Sentry source maps, provide `SENTRY_AUTH_TOKEN` as a build secret (`docker build --secret id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN`); without it the upload is skipped. See comments at the top of `Dockerfile`.

Local example:

```bash
docker build -t deni-ai \
  --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://example.com \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=... \
  .

docker run --rm -p 3000:3000 --env-file .env.production deni-ai
```

### Canary / staging on Dokploy

Run `canary` as its own Dokploy application next to production (which tracks `master`):

- Same repository and `Dockerfile`, branch `canary`, auto deploy on push; give it its own domain (for example `canary.deniai.app`).
- Build args and environment: `NEXT_PUBLIC_BETTER_AUTH_URL` set to that domain (build time, like every `NEXT_PUBLIC_*`); in the Environment tab, a separate `DATABASE_URL` with the migrations applied and Stripe test keys. Add the canary callback URLs to the Google/GitHub OAuth apps if social sign-in should work there.
- `DISABLE_BACKGROUND_JOBS=1`: the server skips the usage/meter and storage jobs and the model health probes (which spend provider tokens). The cron routes still work with `CRON_SECRET` if you need a run.
- `NOINDEX=1`: every response carries `X-Robots-Tag: noindex, nofollow` and `/robots.txt` disallows everything, so the copy stays out of search results.
- To keep it private, put the domain behind an access gate in front of the app, such as Cloudflare Access (the domain must be proxied through Cloudflare). Let `/api/stripe/webhook` bypass the gate if Stripe should reach the canary.

### Other platforms

Any host that can run a Node.js server (Railway, Render, Fly.io, AWS/GCP/Azure, etc.):

- Set the core environment variables and any optional provider keys you want to enable
- Use PostgreSQL (Neon recommended)
- Build: `pnpm run build` (or the Docker image)
- Start: `pnpm start` / `node .output/server/index.mjs` / container CMD

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
- Request bodies are capped while streaming, including requests with missing or incorrect `Content-Length`: chat 16 MiB, tRPC 2 MiB per request except data imports (`migration.import`, 30 MiB including the envelope for 25 MB of JSON) and comparison transcripts (`chat.saveComparison` 20 MiB: one side's last chat request, at most 16 MiB, plus 4 MiB for its final answer, which no chat request carried; `chat.saveComparisonSession` 40 MiB for both sides in one body, deliberately above the import cap, and read only after the Pro check), chat stop and device authentication 4 KiB. A batched tRPC request gets the smallest limit among its calls, so batching cannot lift a procedure's limit; the client sends those three procedures unbatched (`src/lib/trpc/limits.ts`). A comparison over these limits gets a "too large to save" message instead of a retry prompt. Attachments retain their existing upload limits. The model receives at most the latest 20 binary attachments; older files remain in saved history. Remote binary downloads are limited to 10 MiB per file and 20 MiB per generation, four concurrent downloads, and a 10-second timeout per download batch. Every redirect uses the DNS-pinned public-network transport. Inline binary attachments are also size-checked.
- Advertising view and checkout bodies are capped at 4 KiB; creative submission/edit bodies at 32 KiB. Stripe webhook bodies are capped at 4 MiB and verified against their original raw bytes; unsigned requests are rejected without reading the body. Oversized signed deliveries return 413, so investigate delivery failures before replaying an unusually large event.
- Device polling is limited to 60 requests per minute per resolved IP in addition to the per-code limit; approval attempts are limited to 10 per minute per authenticated account. Configure trusted client-IP headers and shared Redis as appropriate for your deployment; without Redis, limits are local to each process.
- The tRPC procedures listed here, which call Stripe or read every row on each call, are limited per signed-in user with the shared rate limiter (Upstash when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set, otherwise per instance), and refuse further calls with 429 `TOO_MANY_REQUESTS` ("Too many requests. Please try again later.") until that window, which starts at the first counted call, ends. Each procedure has its own budget per minute: 30 for `billing.status`, `billing.plans`, `billing.flashOffer`, `billing.estimatePlanChange`, `billing.getCheckoutSession`, `organization.teamPlans`, `organization.teamBillingStatus`, `organization.estimateTeamPlanChange`, `organization.invitationBillingImpact` and `organization.getTeamCheckoutSession`; 60 for `billing.maxModeStatus` and `organization.teamMaxModeSettings` (the team Max Mode editor refetches both after every saved field); 120 for `chat.getChats` (refetched after each sent message, which chat itself limits to 30 a minute, and after each sidebar delete, pin, edit or move); 10 for `billing.accountDeletionStatus` and for the Stripe-backed mutations `billing.createCheckoutSession`, `billing.createPortalSession`, `billing.changePlan`, `billing.cancelSubscription`, `billing.resumeSubscription`, `billing.enableMaxMode`, `billing.createMaxModeCreditCheckout`, `billing.updateMaxModeAutoTopUp`, `billing.removeVerifiedCard`, `organization.createTeamCheckoutSession`, `organization.createTeamPortalSession`, `organization.changeTeamPlan`, `organization.cancelTeamSubscription`, `organization.resumeTeamSubscription`, `organization.updateTeamMaxModeEnabled`, `organization.createTeamMaxModeCreditCheckout`, `organization.updateTeamMaxModeAutoTopUp` and `organization.syncSeatCount`. Card verification is budgeted per hour, since each verification intent is a $1 authorization its client secret can attempt with any card: 10 an hour each for `billing.createCardSetupIntent` and `billing.confirmCardSetup`. Reopening the card dialog reuses the account's newest verification intent still waiting for a card instead of creating another; each authorized card uses one up. The client caches these queries for 60 seconds without refetching on focus, so normal use stays several times below the budgets, and never retries a query refused with 429 (other failed queries are retried up to three times); the sidebar keeps showing the chats it already loaded when a refetch fails. Budgets are in `TRPC_RATE_LIMITS` (`src/server/api/trpc.ts`); add `rateLimited(name, limit)` before `.input()` on a new expensive procedure.
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
