# syntax=docker/dockerfile:1
#
# Deni Run worker: the job scheduler and (RUN_DISCORD_ENABLED=true) the Discord bot.
# Build from the monorepo root (services/run-worker/Dockerfile.dockerignore applies):
#   docker build -f services/run-worker/Dockerfile -t deni-run-worker .
FROM node:26-alpine AS build

WORKDIR /app

RUN npm install -g pnpm@12.18.0

# Every workspace manifest is copied so the frozen lockfile matches; only the
# worker and the workspace packages it depends on are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/support/package.json ./apps/support/
COPY services/agent-api/package.json ./services/agent-api/
COPY services/run-worker/package.json ./services/run-worker/
COPY packages ./packages
# Install scripts are skipped: the bundle only needs sources (Playwright's browser
# download is not wanted either; the browser is Steel's, reached over CDP).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts --filter "@deniai/run-worker..." --store-dir=/pnpm/store

WORKDIR /app/services/run-worker

COPY services/run-worker/tsconfig.json ./
COPY services/run-worker/src ./src

RUN pnpm run build \
  # playwright-core stays outside the bundle (it reads its own files at runtime). It has
  # no dependencies, so the resolved package directory is copied as is.
  && mkdir -p /out/node_modules \
  && cp dist/worker.mjs /out/worker.mjs \
  && cp -rL "$(node -p "require('node:path').dirname(require.resolve('playwright-core/package.json', { paths: ['/app/packages/run'] }))")" /out/node_modules/playwright-core

FROM node:26-alpine AS app

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /out ./

# Several workers may run (jobs are claimed with FOR UPDATE SKIP LOCKED); run the
# Discord bot (RUN_DISCORD_ENABLED=true) on exactly one of them.
CMD ["node", "worker.mjs"]
