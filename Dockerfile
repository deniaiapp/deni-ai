# syntax=docker/dockerfile:1

ARG NODE_VERSION=26-bookworm-slim

FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Corepackを最新に更新し、packageManagerで指定したpnpmをこのレイヤーに入れておく
RUN npm install -g corepack@latest \
  && corepack enable && corepack install
# pnpmストアをBuildKitキャッシュに置き、lockfile変更時も差分だけ取得する。
# devDependenciesも必要なので、NODE_ENV=productionより前に実行する
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Imported at build time; the database is only contacted at runtime.
ENV BETTER_AUTH_SECRET=build-placeholder-secret-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3000

ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_SUPPORT_EMAIL=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL

COPY . .
# vinext buildはoutput: "standalone"でdist/standaloneに自己完結したサーバーを出力する
RUN pnpm build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PORT=3000
# vinextのサーバーはHOSTNAMEではなくHOSTを読む
ENV HOST=0.0.0.0

RUN mkdir -p .deni scripts \
  && chown node:node .deni scripts

# standaloneにはpublic、ビルド成果物、実行時に必要なnode_modulesが含まれる
COPY --from=builder --chown=node:node /app/dist/standalone ./
COPY --from=builder --chown=node:node /app/scripts/docker-entrypoint.sh ./entrypoint.sh

RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
