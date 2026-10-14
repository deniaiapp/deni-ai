import vinext from "vinext";
import { defineConfig } from "vite";
import nextIntl from "./vite-plugins/next-intl";

export default defineConfig({
  plugins: [nextIntl(), vinext()],
  build: {
    rolldownOptions: {
      // vinext's optimize-imports skips the client environment, so without this the client build
      // transforms every icon in the lucide-react and @phosphor-icons/react barrels (~6,400 modules).
      experimental: { lazyBarrel: true },
    },
  },
});
