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
