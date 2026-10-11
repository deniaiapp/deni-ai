# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-bookworm-slim

# pnpmのセットアップは一度だけ行い、レイヤーキャッシュで使い回す
FROM node:${NODE_VERSION} AS base
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Corepackを最新に更新してからpnpm@12を有効化
RUN npm install -g corepack@latest \
  && corepack enable && corepack prepare pnpm@12 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpmストアをBuildKitキャッシュに置き、lockfile変更時も差分だけ取得する
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM base AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production
# Imported at build time; the database is only contacted at runtime.
ENV BETTER_AUTH_SECRET=build-placeholder-secret-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3000

ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_SUPPORT_EMAIL=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .next/cacheをビルド間で保持し、Turbopackが前回の結果を再利用できるようにする
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
  pnpm build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN mkdir -p .next .deni scripts \
  && chown node:node .next .deni scripts

# Next.js standalone（出力設定）が有効な場合、runner側でpnpmは不要になります
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/scripts/docker-entrypoint.sh ./entrypoint.sh

RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
