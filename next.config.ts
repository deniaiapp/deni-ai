import type { NextConfig } from "next";

// Read by vinext. next-intl is wired up in vite-plugins/next-intl.ts instead of
// createNextIntlPlugin(), which does not run under vinext.
const nextConfig: NextConfig = {
  output: "standalone",
  // @vercel/oidc (pulled in by the AI SDK gateway) has a circular require between auth-config
  // and token-util that Vite's dev module runner cannot evaluate, so Node loads it directly.
  serverExternalPackages: ["playwright", "playwright-core", "stripe", "discord.js", "@vercel/oidc"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
};

export default nextConfig;
