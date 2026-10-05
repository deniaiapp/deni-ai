import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin({
  experimental: {
    srcPath: ["./app", "./components", "./lib"],
    extract: {},
    messages: {
      path: "./messages",
      format: "po",
      locales: ["en", "ja"],
      sourceLocale: "en",
    },
  },
});

const playwrightTrace = [
  "./node_modules/playwright/**/*",
  "./node_modules/playwright-core/**/*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core", "stripe"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  outputFileTracingIncludes: {
    "/api/chat": playwrightTrace,
    "/api/computer/:path*": playwrightTrace,
    "/api/handoffs": playwrightTrace,
    "/api/account": playwrightTrace,
  },
  outputFileTracingExcludes: {
    "/*": ["./.deni/**/*"],
  },
};

export default withNextIntl(nextConfig);
