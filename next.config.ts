import type { NextConfig } from "next";

const playwrightTrace = [
  "./node_modules/playwright/**/*",
  "./node_modules/playwright-core/**/*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core", "stripe", "postgres"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/postgres/**/*"],
    "/api/chat": playwrightTrace,
    "/api/computer/:path*": playwrightTrace,
    "/api/handoffs": playwrightTrace,
    "/api/account": playwrightTrace,
  },
  outputFileTracingExcludes: {
    "/*": ["./.deni/**/*"],
  },
};

export default nextConfig;
