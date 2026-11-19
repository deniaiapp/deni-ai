import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import type { Plugin } from "vite";

const compress = promisify(brotliCompress);

/** Text-like files worth compressing (Nitro's rule: at least 1 KiB, no source maps). */
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".otf",
  ".svg",
  ".ttf",
  ".txt",
  ".wasm",
  ".webmanifest",
  ".xml",
]);
const BINARY_EXTENSIONS = new Set([".otf", ".ttf", ".wasm"]);
const MIN_SIZE = 1024;

/** Files under `directory`, relative to it; empty when it does not exist. */
async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

/**
 * Writes `<file>.br` at brotli quality 9 for every compressible client output
 * file and every file in Vite's `publicDir` (Nitro copies those into the
 * output after the client build, so their `.br` copies are written there in
 * advance). Nitro's `compressPublicAssets` only offers quality 11, which costs
 * about 7x the CPU time for roughly 8% smaller files; Nitro still serves these
 * `.br` files by Accept-Encoding, so leave its `brotli` option off and keep
 * `gzip` on.
 */
export function precompressBrotli({ quality = 9 }: { quality?: number } = {}): Plugin {
  return {
    name: "deni:precompress-brotli",
    apply: "build",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    async writeBundle(outputOptions) {
      const outDir = outputOptions.dir;
      if (!outDir) return;
      const { publicDir } = this.environment.config;
      // Relative path → source file; build output wins over a public file of the same name.
      const sources = new Map<string, string>();
      for (const directory of publicDir ? [publicDir, outDir] : [outDir]) {
        for (const file of await listFiles(directory)) {
          if (COMPRESSIBLE_EXTENSIONS.has(path.extname(file))) {
            sources.set(file, path.join(directory, file));
          }
        }
      }
      await Promise.all(
        [...sources].map(async ([file, source]) => {
          const contents = await readFile(source);
          if (contents.length < MIN_SIZE) return;
          const compressed = await compress(contents, {
            params: {
              [constants.BROTLI_PARAM_MODE]: BINARY_EXTENSIONS.has(path.extname(file))
                ? constants.BROTLI_MODE_GENERIC
                : constants.BROTLI_MODE_TEXT,
              [constants.BROTLI_PARAM_QUALITY]: quality,
              [constants.BROTLI_PARAM_SIZE_HINT]: contents.length,
            },
          });
          const target = path.join(outDir, `${file}.br`);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, compressed);
        }),
      );
    },
  };
}
