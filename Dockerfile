# syntax=docker/dockerfile:1
#
# Dokploy (Dockerfile build)
# -------------------------
# Application settings:
#   Build Type:        Dockerfile
#   Dockerfile path:   Dockerfile
#   Docker context:    .
#   Port:              3000
#
# Environment (service Environment tab):
#   - Put ALL required secrets/public vars there (same as .env.production).
#   - Add the same keys under Build Time Arguments (or mark them build-time)
#     so Dokploy passes them as `docker build --build-arg`. The builder stage
#     declares matching ARG/ENV so `vite build` sees real prod values.
#   - NEXT_PUBLIC_* MUST be build-time (embedded into the client bundle).
#   - Server secrets are read from the runtime environment; build-time values
#     only matter for code that runs during the build.
#
# Local:
#   docker build -t deni-ai .
#   # With prod public/client values (repeat --build-arg per key, or use Dokploy):
#   docker build -t deni-ai --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://example.com .
#   docker run --rm -p 3000:3000 --env-file .env.production deni-ai

# ---------------------------------------------------------------------------
# Install dependencies (pnpm workspaces + pnpm-lock.yaml), then build.
# Dependencies are installed in the build stage itself: `node_modules` is an
# ordinary layer (cached while the lockfile is unchanged), with no COPY of
# thousands of files and no bind mount.
# ---------------------------------------------------------------------------
FROM node:26-slim AS builder
WORKDIR /app
RUN npm install --global pnpm@latest
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/disposable-email-domains ./packages/disposable-email-domains
# Install before NODE_ENV=production so devDependencies (Vite, Tailwind, the
# React Compiler) are present for the build.
RUN --mount=type=cache,id=deni-ai-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store

ENV NODE_ENV=production

COPY . .

# Dokploy / `docker build --build-arg` inject service env here.
# Core keys keep placeholder defaults so a bare `docker build` still compiles.
# Provider/integration keys have no default, so missing keys disable their
# dependent features; emptyStringAsUndefined in src/env.ts treats "" as unset.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ARG BETTER_AUTH_SECRET=01234567890123456789012345678901
ARG GOOGLE_CLIENT_ID
ARG GOOGLE_CLIENT_SECRET
ARG GITHUB_CLIENT_ID
ARG GITHUB_CLIENT_SECRET
ARG STRIPE_SECRET_KEY
ARG STRIPE_WEBHOOK_SECRET
ARG STRIPE_FLASH_OFFER_COUPON_ID
ARG OPENROUTER_API_KEY
ARG DENI_API_KEY
ARG DENI_API_BASE_URL
ARG EXA_API_KEY
ARG TURNSTILE_SECRET_KEY
ARG RESEND_API_KEY
ARG UPSTASH_REDIS_REST_URL
ARG UPSTASH_REDIS_REST_TOKEN
ARG R2_ACCOUNT_ID
ARG R2_ACCESS_KEY_ID
ARG R2_SECRET_ACCESS_KEY
ARG R2_BUCKET
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BILLING_DISABLED
ARG NEXT_PUBLIC_SENTRY_DSN
# Optional: uploads source maps to Sentry during `vite build` when set.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

# Promote ARG → ENV so `vite build` / env.ts validation / NEXT_PUBLIC inlining
# all see production values when Dokploy (or --build-arg) supplies them.
ENV DATABASE_URL=$DATABASE_URL \
  BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET \
  GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET \
  GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID \
  GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET \
  STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY \
  STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET \
  STRIPE_FLASH_OFFER_COUPON_ID=$STRIPE_FLASH_OFFER_COUPON_ID \
  OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  DENI_API_KEY=$DENI_API_KEY \
  DENI_API_BASE_URL=$DENI_API_BASE_URL \
  EXA_API_KEY=$EXA_API_KEY \
  TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY \
  RESEND_API_KEY=$RESEND_API_KEY \
  UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL \
  UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN \
  R2_ACCOUNT_ID=$R2_ACCOUNT_ID \
  R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
  R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
  R2_BUCKET=$R2_BUCKET \
  NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
  NEXT_PUBLIC_BILLING_DISABLED=$NEXT_PUBLIC_BILLING_DISABLED \
  NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
  SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
  SENTRY_ORG=$SENTRY_ORG \
  SENTRY_PROJECT=$SENTRY_PROJECT

# Empty NEXT_PUBLIC_* vars are unset right before `vite build` (see the RUN below) so
# the committed .env.production supplies them: Vite never overrides a variable that
# already exists in the environment, even as an empty string (which an unset ARG becomes).
# Non-empty build args (Dokploy / --build-arg) still take precedence.
RUN for v in NEXT_PUBLIC_BETTER_AUTH_URL NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_BILLING_DISABLED NEXT_PUBLIC_SENTRY_DSN; do \
    [ -n "$(printenv "$v")" ] || unset "$v"; \
  done; \
  node ./node_modules/vite/bin/vite.js build

# ---------------------------------------------------------------------------
# Runtime (Nitro Node.js server output in .output)
# ---------------------------------------------------------------------------
FROM node:26-slim AS runner
WORKDIR /app

# NODE_OPTIONS caps the V8 heap at 75% of the container memory limit so GC runs before
# the kernel OOM-kills the process (leaves headroom for buffers/native memory).
# Dokploy / Traefik reach the container on this port.
# HOST=0.0.0.0 is only the listen bind address (not the public site URL).
# Never set NEXT_PUBLIC_BETTER_AUTH_URL to http://0.0.0.0:3000 — use the real
# public origin (e.g. https://deniai.app) at build time.
ENV PORT=3000 \
  HOST=0.0.0.0 \
  NODE_ENV=production \
  NODE_OPTIONS=--max-old-space-size-percentage=75

# Official Node.js images include a non-root `node` user/group.
# `.output` holds the server bundle, its traced node_modules and public assets.
COPY --from=builder --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
