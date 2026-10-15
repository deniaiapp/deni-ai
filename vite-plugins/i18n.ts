import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { extractConfig, extractMessages } from "../i18n/extract.ts";
import { catalogMessages, parsePo } from "../i18n/po.ts";

// Compiles messages/*.po into { id: message } modules for use-intl, and keeps the catalogs in sync
// with the messages in the source: once per build, and after each source change in dev.

const sourceFile = /\.(?:[cm]?[jt]sx?)$/;

export default function i18n(): Plugin {
  let root = process.cwd();
  let messagesDir = path.resolve(root, extractConfig.messagesDir);
  let extraction: Promise<string[] | void> | undefined;

  function extract() {
    extraction ??= extractMessages(root)
      .catch((error: unknown) => {
        console.error("[i18n] message extraction failed", error);
      })
      .finally(() => {
        extraction = undefined;
      });
    return extraction;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleExtract(server: ViteDevServer, file: string) {
    if (!sourceFile.test(file) || file.includes("node_modules")) return;
    const inSrc = extractConfig.srcPaths.some((dir) => file.startsWith(path.resolve(root, dir) + path.sep));
    if (!inSrc) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void extract().then((written) => {
        if (written && written.length > 0) server.config.logger.info(`[i18n] catalogs updated: ${written.join(", ")}`);
      });
    }, 300);
  }

  return {
    name: "deni:i18n",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      messagesDir = path.resolve(root, extractConfig.messagesDir);
    },
    async buildStart() {
      // vite build runs this once per environment; the in-flight promise keeps it to one
      // extraction at a time.
      await extract();
    },
    configureServer(server) {
      server.watcher.on("change", (file) => scheduleExtract(server, file));
      server.watcher.on("add", (file) => scheduleExtract(server, file));
    },
    load: {
      filter: { id: /\.po$/ },
      async handler(id) {
        const file = path.resolve(id.split("?")[0]);
        if (path.dirname(file) !== messagesDir) return null;
        this.addWatchFile(file);
        const messages = catalogMessages(parsePo(await readFile(file, "utf8")));
        // https://v8.dev/blog/cost-of-javascript-2019#json
        return { code: `export default JSON.parse(${JSON.stringify(JSON.stringify(messages))});`, map: null };
      },
    },
  };
}
