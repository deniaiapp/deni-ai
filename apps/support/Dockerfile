# syntax=docker/dockerfile:1
#
# minidock app `support` (built from git)
#   Dockerfile path: apps/support/Dockerfile
#   Docker context:  . (the monorepo root; apps/support/Dockerfile.dockerignore applies)
#   Port:            3000
#   Domain:          support.deniai.app
#
# No build arguments are needed. The support chat and forms read optional
# runtime environment variables; see README.md and .env.example.
#
# Local (from the monorepo root):
#   docker build -f apps/support/Dockerfile -t deni-ai-support .
#   docker run --rm -p 3000:3000 deni-ai-support

FROM node:26-alpine AS base
WORKDIR /app
# Matches `packageManager` in the root package.json (lockfile format and settings).
RUN npm install --global pnpm@12.18.0
# Every workspace manifest is copied so the frozen lockfile matches; only the
# help center is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/support/package.json ./apps/support/
COPY services/agent-api/package.json ./services/agent-api/
COPY services/run-worker/package.json ./services/run-worker/
COPY services/rollout-router/package.json ./services/rollout-router/
# Package sources follow the install, so editing them keeps the install cached.
COPY --parents packages/*/package.json ./

FROM base AS builder
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@deniai/support..." --store-dir=/pnpm/store
ENV NODE_ENV=production
COPY packages ./packages
COPY apps/support ./apps/support
WORKDIR /app/apps/support
RUN pnpm run build

# The server bundle still imports a few packages at runtime (react through a
# CommonJS require, takumi-js for OG images, the search index), and takumi-js
# loads its native renderer dynamically, so the runtime keeps production
# node_modules instead of relying on Nitro's dependency tracing. pnpm links
# apps/support/node_modules into the root node_modules/.pnpm store, so both
# directories are kept with the same layout.
# The install runs on Alpine (musl) but the runner is glibc, so `--libc=glibc`
# picks the glibc builds of native packages such as takumi-js.
FROM base AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --libc=glibc --filter "@deniai/support..." --store-dir=/pnpm/store

# Distroless: Node.js and its runtime libraries only (no shell, package manager,
# or npm). The `nonroot` tag runs as uid 65532 and its entrypoint is `node`.
# For an interactive shell while debugging, swap in the `debug-nonroot` tag.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runner
WORKDIR /app/apps/support
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000
COPY --from=deps --chown=nonroot:nonroot /app/node_modules /app/node_modules
COPY --from=deps --chown=nonroot:nonroot /app/apps/support/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/apps/support/.output ./.output
EXPOSE 3000
# The image's entrypoint is already `node`, so CMD carries only the script.
CMD [".output/server/index.mjs"]
