import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import i18n from "./vite-plugins/i18n.ts";

// NEXT_PUBLIC_* names are kept from the Next.js setup so deployments keep working. Like Next.js,
// they are inlined at build time, on the client and the server.
const publicEnv = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPPORT_EMAIL"];

// UI libraries ship "use client" directives for React Server Components, which Start does not use.
function onwarn(warning: { code?: string }, warn: (warning: never) => void) {
  if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
  warn(warning as never);
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "NEXT_PUBLIC_"), ...process.env };
  return {
    server: { port: 3000 },
    resolve: { tsconfigPaths: true },
    define: Object.fromEntries(
      publicEnv.map((name) => [`process.env.${name}`, JSON.stringify(env[name] ?? "")]),
    ),
    plugins: [
      tailwindcss(),
      i18n(),
      tanstackStart({
        srcDirectory: "app",
        router: { quoteStyle: "double", semicolons: true },
      }),
      nitro({
        plugins: ["./server/plugins/background.ts"],
        // Loaded by Node from .output/server/node_modules instead of being bundled: Playwright
        // and discord.js load optional native and dynamic modules, and @vercel/oidc (pulled in
        // by the AI SDK gateway) has a circular require between auth-config and token-util.
        traceDeps: ["playwright", "playwright-core", "stripe", "discord.js", "@vercel/oidc"],
        rolldownConfig: { onwarn },
      }),
      viteReact(),
    ],
    build: {
      rolldownOptions: {
        // Without this the client build transforms every icon in the lucide-react and
        // @phosphor-icons/react barrels (~6,400 modules).
        experimental: { lazyBarrel: true },
        onwarn,
      },
    },
  };
});
