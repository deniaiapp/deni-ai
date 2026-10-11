import path from "node:path";
import { unstable_extractMessages } from "next-intl/extractor";
import catalogLoader from "next-intl/extractor/catalogLoader";
import extractionLoader from "next-intl/extractor/extractionLoader";
import type { Plugin, ViteDevServer } from "vite";

// Mirrors what createNextIntlPlugin() set up under Next.js. vinext only aliases
// `next-intl/config`, so the useExtracted transform, the .po catalog loader, and
// catalog extraction are wired up here by running next-intl's own loaders.

const extractorConfig = {
  srcPath: ["./app", "./components", "./lib"],
  extract: {},
  messages: {
    path: "./messages",
    format: "po",
    locales: ["en", "ja"],
    sourceLocale: "en",
  },
} satisfies Parameters<typeof unstable_extractMessages>[0];

const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const extractedCall = /\b(?:useExtracted|getExtracted)\b/;

type LoaderResult = { code: string; map?: unknown };

// next-intl ships webpack-style loaders. This runs one with the small part of
// the loader context they read.
function runLoader(
  loader: (this: unknown, source: string) => void,
  context: { resourcePath: string; rootContext: string; options?: unknown },
  source: string,
): Promise<LoaderResult> {
  return new Promise((resolve, reject) => {
    loader.call(
      {
        resourcePath: context.resourcePath,
        rootContext: context.rootContext,
        sourceMap: true,
        getOptions: () => context.options ?? {},
        async:
          () =>
          (error: Error | null, code?: string, map?: unknown) => {
            if (error) reject(error);
            else resolve({ code: code ?? "", map });
          },
      },
      source,
    );
  });
}

export default function nextIntl(): Plugin {
  let root = process.cwd();
  let messagesDir = path.resolve(root, extractorConfig.messages.path);
  let extraction: Promise<void> | undefined;

  function extract() {
    extraction ??= unstable_extractMessages(extractorConfig)
      .catch((error: unknown) => {
        console.error("[next-intl] message extraction failed", error);
      })
      .finally(() => {
        extraction = undefined;
      });
    return extraction;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleExtract(server: ViteDevServer, file: string) {
    if (!sourceFile.test(file) || file.includes("node_modules")) return;
    const inSrc = extractorConfig.srcPath.some((dir) =>
      file.startsWith(path.resolve(root, dir) + path.sep),
    );
    if (!inSrc) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void extract().then(() => server.config.logger.info("[next-intl] catalogs updated"));
    }, 300);
  }

  return {
    name: "deni:next-intl",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      messagesDir = path.resolve(root, extractorConfig.messages.path);
    },
    async buildStart() {
      // vite build runs this once per environment (rsc, ssr, client); the
      // in-flight promise keeps it to one extraction at a time.
      await extract();
    },
    configureServer(server) {
      server.watcher.on("change", (file) => scheduleExtract(server, file));
      server.watcher.on("add", (file) => scheduleExtract(server, file));
    },
    async transform(code, id) {
      const file = id.split("?")[0];

      if (file.endsWith(".po") && path.dirname(path.resolve(file)) === messagesDir) {
        const result = await runLoader(
          catalogLoader as never,
          {
            resourcePath: file,
            rootContext: root,
            options: {
              messages: {
                format: extractorConfig.messages.format,
                sourceLocale: extractorConfig.messages.sourceLocale,
              },
            },
          },
          code,
        );
        return { code: result.code, map: null };
      }

      if (!sourceFile.test(file) || !extractedCall.test(code)) return null;
      const result = await runLoader(
        extractionLoader as never,
        { resourcePath: file, rootContext: root },
        code,
      );
      return { code: result.code, map: (result.map as never) ?? null };
    },
  };
}
