import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vite";
import { extractMessages } from "./vite/extract-messages.ts";
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
    resolve: { tsconfigPaths: true },
    build: {
      rolldownOptions: {
        // Libraries ship RSC "use client" markers, which mean nothing here.
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          handler(level, log);
        },
      },
    },
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              // Automatic splitting alone emits ~160 sub-2KB common chunks (single
              // icons, helpers) shared between route chunks, so a page waits on
              // 100+ requests. Copy those small chunks into the chunks that use
              // them instead; each page still loads only the code it needs.
              codeSplitting: {
                experimentalInlineCommonChunks: { maxSize: 4 * 1024 },
              },
            },
          },
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
      tanstackStart(),
      nitro({
        routeRules,
        // Serve prebuilt .gz/.br copies of JS, CSS and other static files.
        compressPublicAssets: { gzip: true, brotli: true },
        // The AI SDK loads `undici` through createRequire(), which tracing cannot see.
        traceDeps: ["undici"],
      }),
      viteReact({ compiler: true }),
      // Uploads source maps only when SENTRY_AUTH_TOKEN is set (SENTRY_ORG and
      // SENTRY_PROJECT come from the environment).
      sentryTanstackStart({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        silent: !process.env.CI,
        telemetry: false,
        sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
        autoInstrumentMiddleware: true,
      }),
    ],
  };
});
