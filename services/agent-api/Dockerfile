# syntax=docker/dockerfile:1
#
# Build from the monorepo root (services/agent-api/Dockerfile.dockerignore applies):
#   docker build -f services/agent-api/Dockerfile -t deni-agent-api .
FROM node:26-alpine AS build

WORKDIR /app

RUN npm install -g pnpm@12.18.0

# Every workspace manifest is copied so the frozen lockfile matches; only the
# agent API and the workspace packages it depends on are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/support/package.json ./apps/support/
COPY services/agent-api/package.json ./services/agent-api/
COPY packages ./packages
# Dev dependencies are needed for the esbuild step. Install scripts are skipped:
# the bundle only needs sources. The pnpm store is a BuildKit cache mount shared
# with the other projects (id=pnpm-store).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts --filter "@deniai/agent-api..." --store-dir=/pnpm/store

WORKDIR /app/services/agent-api

COPY services/agent-api/server.ts services/agent-api/app.ts services/agent-api/tsconfig.json ./
COPY services/agent-api/middleware ./middleware
COPY services/agent-api/routes ./routes
COPY services/agent-api/utils ./utils

RUN node_modules/.bin/esbuild server.ts --bundle --platform=node --format=esm --target=node26 \
  --outdir=./dist --external:pg-native --minify \
  --banner:js="import { createRequire as __flixaCreateRequire } from 'node:module'; const require = __flixaCreateRequire(import.meta.url);"

FROM node:26-alpine AS app

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Self-contained ESM bundle; .mjs so Node does not need a package.json "type".
COPY --from=build /app/services/agent-api/dist/server.js ./server.mjs

EXPOSE 3000

CMD ["node", "server.mjs"]
