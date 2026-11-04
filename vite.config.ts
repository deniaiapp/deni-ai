import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { nitro } from 'nitro/vite';

export default defineConfig(({ mode }) => {
  // Server code reads `process.env`, which Vite doesn't fill from `.env` files.
  // Load them for local development; variables set in the environment win.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value;
  }

  return {
    server: {
      port: 3000,
    },
    plugins: [
      fumadocsMdx(),
      tailwindcss(),
      tanstackStart(),
      react(),
      // Runs as a Node server on Dokploy, like deni-ai. Pages are rendered on
      // request so `/` can redirect by `Accept-Language`.
      nitro({
        preset: 'node-server',
      }),
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        tslib: 'tslib/tslib.es6.js',
      },
    },
  };
});
