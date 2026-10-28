import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import { extractMessages } from "./vite/extract-messages.ts";
import { routeRules } from "./vite/route-rules.ts";

// Vite re-runs this config in the same process after an .env edit. Remember
// which keys came from .env files so a reload can replace them instead of
// treating last load's values as real environment variables.
const envFileState = ((globalThis as { __deniEnvFileKeys?: Set<string> }).__deniEnvFileKeys ??=
  new Set());

export default defineConfig(({ mode }) => {
  // Server code reads process.env; load .env, .env.local and .env.[mode] like
  // Next.js did (.env.local wins over .env). Variables set in the shell win.
  // Vite's loadEnv also prefers process.env, so drop file-loaded keys first.
  for (const key of envFileState) delete process.env[key];
  envFileState.clear();
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      envFileState.add(key);
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
