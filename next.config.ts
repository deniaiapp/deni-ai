import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core", "stripe", "postgres"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/postgres/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": ["./.deni/**/*"],
  },
};

export default nextConfig;
