import { defineConfig } from "vitest/config";
import { authDedupe } from "@deniai/auth/dedupe";
import { extractMessages } from "@deniai/i18n/vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    dedupe: authDedupe,
  },
  plugins: [
    extractMessages({
      srcPath: "./src",
      messagesPath: "./messages",
      sourceLocale: "en",
      locales: ["en", "ja"],
      writeCatalogs: false,
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
    },
  },
});
