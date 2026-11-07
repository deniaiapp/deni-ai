# syntax=docker/dockerfile:1
#
# Dokploy (Dockerfile build)
#   Build Type:      Dockerfile
#   Dockerfile path: Dockerfile
#   Docker context:  .
#   Port:            3000
#   Domain:          support.deniai.app
#
# No build arguments are needed. The support chat and forms read optional
# runtime environment variables; see README.md and .env.example.
#
# Local:
#   docker build -t deni-ai-support .
#   docker run --rm -p 3000:3000 deni-ai-support

FROM node:26-slim AS base
WORKDIR /app
RUN npm install --global pnpm@latest
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS builder
RUN --mount=type=cache,id=deni-ai-support-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store
ENV NODE_ENV=production
COPY . .
RUN pnpm run build

# The server bundle still imports a few packages at runtime (react through a
# CommonJS require, takumi-js for OG images, the search index), and takumi-js
# loads its native renderer dynamically, so the runtime keeps production
# node_modules instead of relying on Nitro's dependency tracing.
FROM base AS deps
RUN --mount=type=cache,id=deni-ai-support-pnpm,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
