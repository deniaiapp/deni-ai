import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vite";
import { authDedupe } from "@deniai/auth/dedupe";
import { extractMessages } from "@deniai/i18n/vite";
import { overlapClientSourceMapUpload } from "./vite/overlap-source-map-upload.ts";
import { precompressBrotli } from "./vite/precompress-brotli.ts";
import { routeRules } from "./vite/route-rules.ts";

// Vite re-runs this config in the same process after an .env edit. Remember
// which keys came from .env files so a reload can replace them instead of
// treating last load's values as real environment variables.
const envFileState = ((globalThis as { __deniEnvFileKeys?: Set<string> }).__deniEnvFileKeys ??=
  new Set());

/**
 * Next.js precedence, highest first. Vite's own loadEnv ranks `.env.[mode]`
 * above `.env.local`, which would bake production URLs from .env.production
 * into local builds.
 */
function envFiles(mode: string) {
  return [`.env.${mode}.local`, ...(mode === "test" ? [] : [".env.local"]), `.env.${mode}`, ".env"];
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  // Server code reads process.env, and Vite fills import.meta.env from
  // process.env before .env files, so loading the files here keeps server and
  // browser values identical. Variables set in the shell win.
  for (const key of envFileState) delete process.env[key];
  envFileState.clear();
  for (const file of envFiles(mode)) {
    for (const [key, value] of Object.entries(readEnvFile(file))) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        envFileState.add(key);
      }
    }
  }

  return {
    server: { port: 3000 },
    // Public env keys keep their NEXT_PUBLIC_ names so existing deployment
    // configuration (Dokploy build args, Vercel env) carries over unchanged.
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    resolve: { tsconfigPaths: true, dedupe: authDedupe },
    // Deni Run's browser provider imports playwright-core lazily at runtime (see traceDeps).
    // The in-process Run Discord bot loads discord.js lazily; it stays a traced dependency.
    ssr: { external: ["playwright-core", "discord.js"] },
    build: {
      rolldownOptions: {
        // Libraries ship RSC "use client" markers, which mean nothing here.
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          handler(level, log);
        },
      },
    },
    plugins: [
      // Must run before TanStack's route code splitting copies component code.
      extractMessages({
        srcPath: "./src",
        messagesPath: "./messages",
        sourceLocale: "en",
        locales: ["en", "ja"],
      }),
      tailwindcss(),
      precompressBrotli(),
      tanstackStart(),
      nitro({
        routeRules,
        // Serve prebuilt .gz/.br copies of JS, CSS and other static files. The .br
        // copies come from precompressBrotli (quality 9); Nitro's own brotli uses
        // quality 11, which was the slowest part of the deploy build for ~8% gain.
        compressPublicAssets: { gzip: true },
        // The AI SDK loads `undici` through createRequire(), which tracing cannot see.
        // Deni Run's browser provider loads playwright-core at runtime; it reads its own
        // files, so it stays an external traced dependency instead of being bundled.
        traceDeps: ["undici", "playwright-core", "discord.js"],
        // startup: loads the server entry at boot so in-process schedulers start then.
        // shutdown: runs src/lib/shutdown.server.ts handlers (the in-process Run worker).
        plugins: ["./src/server/nitro/startup.ts", "./src/server/nitro/shutdown.ts"],
      }),
      viteReact({ compiler: true }),
      // Uploads source maps only when SENTRY_AUTH_TOKEN is set (SENTRY_ORG and
      // SENTRY_PROJECT come from the environment), then deletes them. Without a
      // token no maps are generated: they would be served publicly from /assets.
      // The client upload overlaps the SSR build (see overlapClientSourceMapUpload).
      ...overlapClientSourceMapUpload(
        sentryTanstackStart({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          silent: !process.env.CI,
          telemetry: false,
          // Name the dot directories: `**` does not descend into `.output`, so
          // "**/*.map" matched nothing and the maps shipped in /assets.
          sourcemaps: process.env.SENTRY_AUTH_TOKEN
            ? { filesToDeleteAfterUpload: [".output/**/*.map", "node_modules/.nitro/**/*.map"] }
            : { disable: true },
          autoInstrumentMiddleware: true,
        }),
      ),
    ],
  };
});
