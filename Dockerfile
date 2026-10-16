FROM node:22-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm@12.10.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.ts app.ts tsconfig.json ./
COPY middleware ./middleware
COPY routes ./routes
COPY utils ./utils

RUN bun build server.ts --outdir ./dist --target bun --minify

FROM oven/bun:1-alpine AS app

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/dist/server.js ./server.js

EXPOSE 3000

CMD ["bun", "server.js"]
