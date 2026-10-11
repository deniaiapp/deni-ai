import type { NextConfig } from "next";

// Read by vinext. next-intl is wired up in vite-plugins/next-intl.ts instead of
// createNextIntlPlugin(), which does not run under vinext.
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core", "stripe", "discord.js"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
};

export default nextConfig;
