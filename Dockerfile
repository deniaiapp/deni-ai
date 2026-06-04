FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts tsconfig.json ./
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
