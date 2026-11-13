# syntax=docker/dockerfile:1
#
# Dokploy (Dockerfile build)
# -------------------------
# Application settings:
#   Build Type:        Dockerfile
#   Dockerfile path:   apps/web/Dockerfile
#   Docker context:    . (the monorepo root; apps/web/Dockerfile.dockerignore applies)
#   Port:              3000
#
# Environment (service Environment tab):
#   - Put ALL secrets and runtime settings there (same as .env.production). The
#     server reads them when the container starts; none are needed to build.
#   - Build Time Arguments: only the public NEXT_PUBLIC_* values (embedded into
#     the client bundle) and, optionally, SENTRY_ORG / SENTRY_PROJECT.
#   - Never pass secrets as build arguments: ARG/ENV values stay in the build
#     cache and image history. SENTRY_AUTH_TOKEN is a build secret instead
#     (`docker build --secret id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN`);
#     without it the build skips the source map upload.
#
# Local:
#   # From the monorepo root:
#   docker build -f apps/web/Dockerfile -t deni-ai .
#   # With prod public/client values (repeat --build-arg per key, or use Dokploy):
#   docker build -f apps/web/Dockerfile -t deni-ai --build-arg NEXT_PUBLIC_BETTER_AUTH_URL=https://example.com .
#   docker run --rm -p 3000:3000 --env-file apps/web/.env.production deni-ai

# ---------------------------------------------------------------------------
# Install dependencies (pnpm workspace + the root pnpm-lock.yaml), then build.
# Every workspace manifest is copied so the frozen lockfile matches; only
# apps/web and the workspace packages it depends on are installed.
# Dependencies are installed in the build stage itself: `node_modules` is an
# ordinary layer (cached while the manifests and lockfile are unchanged), with
# no COPY of thousands of files and no bind mount. Workspace package sources are
# copied after the install so editing them does not invalidate that layer.
# The builder runs on Alpine (musl): the lockfile carries the musl bindings of
# the native build tools (rolldown, oxc, Tailwind oxide, SWC). The runner is
# glibc, which is safe only while `.output` traces no native `.node` addons.
# ---------------------------------------------------------------------------
FROM node:26-alpine AS builder
WORKDIR /app
# Matches `packageManager` in the root package.json (lockfile format and settings).
RUN npm install --global pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/support/package.json ./apps/support/
COPY services/agent-api/package.json ./services/agent-api/
COPY services/run-worker/package.json ./services/run-worker/
COPY --parents packages/*/package.json ./
# Install before NODE_ENV=production so devDependencies (Vite, Tailwind, the
# React Compiler) are present for the build.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@deniai/web..." --store-dir=/pnpm/store

ENV NODE_ENV=production

COPY packages ./packages
COPY apps/web ./apps/web
WORKDIR /app/apps/web

# Only public values are build arguments: the build never reads server
# secrets, which the runtime stage gets from the container environment.
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BILLING_DISABLED
ARG NEXT_PUBLIC_SENTRY_DSN
# Optional: with the SENTRY_AUTH_TOKEN build secret, `vite build` uploads source maps.
ARG SENTRY_ORG
ARG SENTRY_PROJECT

# Promote ARG → ENV so `vite build` inlines the NEXT_PUBLIC_* values.
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
  NEXT_PUBLIC_BILLING_DISABLED=$NEXT_PUBLIC_BILLING_DISABLED \
  NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
  SENTRY_ORG=$SENTRY_ORG \
  SENTRY_PROJECT=$SENTRY_PROJECT

# Empty NEXT_PUBLIC_* vars are unset right before `vite build` (see the RUN below) so
# the committed .env.production supplies them: Vite never overrides a variable that
# already exists in the environment, even as an empty string (which an unset ARG becomes).
# Non-empty build args (Dokploy / --build-arg) still take precedence.
# The Sentry token is mounted for this step only, so no layer records it.
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN \
  for v in NEXT_PUBLIC_BETTER_AUTH_URL NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_BILLING_DISABLED NEXT_PUBLIC_SENTRY_DSN; do \
    [ -n "$(printenv "$v")" ] || unset "$v"; \
  done; \
  node ./node_modules/vite/bin/vite.js build

# ---------------------------------------------------------------------------
# Runtime (Nitro Node.js server output in .output)
# ---------------------------------------------------------------------------
# Distroless: Node.js and its runtime libraries only (no shell, package manager,
# or npm). The `nonroot` tag runs as uid 65532 and its entrypoint is `node`.
# For an interactive shell while debugging, swap in the `debug-nonroot` tag.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runner
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

# `.output` holds the server bundle, its traced node_modules and public assets.
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/.output ./.output

EXPOSE 3000

# The image's entrypoint is already `node`, so CMD carries only the script.
CMD [".output/server/index.mjs"]
