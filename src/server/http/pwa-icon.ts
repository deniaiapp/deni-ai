import { readFile } from "node:fs/promises";
import { join } from "node:path";

const icons = new Map<string, Promise<Buffer>>();

/**
 * Public assets live in `public/` during development and in `.output/public/`
 * next to the built server (the production image only ships `.output`).
 */
const PUBLIC_DIRS = [join(process.cwd(), "public"), join(process.cwd(), ".output", "public")];

async function readPublicFile(...segments: string[]) {
  let lastError: unknown;
  for (const dir of PUBLIC_DIRS) {
    try {
      return await readFile(join(dir, ...segments));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Serves `public/pwa/android-chrome-<size>.png`; read once per server process. */
export async function pwaIconResponse(size: "192x192" | "512x512") {
  let icon = icons.get(size);
  if (!icon) {
    icon = readPublicFile("pwa", `android-chrome-${size}.png`);
    icons.set(size, icon);
    // A failed read is retried on the next request instead of being cached.
    icon.catch(() => icons.delete(size));
  }

  return new Response(new Uint8Array(await icon), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/png",
    },
  });
}
