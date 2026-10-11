import vinext from "vinext";
import { defineConfig } from "vite";
import nextIntl from "./vite-plugins/next-intl";

export default defineConfig({
  plugins: [nextIntl(), vinext()],
});
