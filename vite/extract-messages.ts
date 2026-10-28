import { createRequire } from "node:module";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "@swc/core";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const EXTRACTOR_PLUGIN = require.resolve("next-intl-swc-plugin-extractor");

/**
 * The SWC extractor only rewrites `getExtracted()` imported from this specifier.
 * Code outside React (route `head`, loaders, server handlers) imports it from
 * `@/i18n/extracted`, so the import is swapped around the SWC pass.
 */
const EXTRACTOR_SERVER_SPECIFIER = '"next-intl/server"';
const APP_EXTRACTED_SPECIFIER = '"@/i18n/extracted"';

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".output", ".tanstack", "dist"]);

type MessageReference = { path: string; line: number; column: number };
type ExtractedMessage = { id: string; message: string; reference: MessageReference };

type ExtractorResult = {
  type: string;
  id: string;
  message: string;
  reference: MessageReference;
};

export type ExtractMessagesOptions = {
  /** Directory scanned for `useExtracted` / `getExtracted` calls. */
  srcPath: string;
  /** Directory holding `<locale>.json` catalogs. */
  messagesPath: string;
  sourceLocale: string;
  locales: readonly string[];
  /** Set to `false` to only compile calls (tests) without touching catalogs. */
  writeCatalogs?: boolean;
};

function usesExtraction(source: string) {
  return source.includes("useExtracted") || source.includes("getExtracted");
}

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

async function compile(
  projectRoot: string,
  absolutePath: string,
  source: string,
  isDevelopment: boolean,
) {
  const filePath = toPosix(path.relative(projectRoot, absolutePath));
  const swappedSource = source.replaceAll(APP_EXTRACTED_SPECIFIER, EXTRACTOR_SERVER_SPECIFIER);
  const result = await transform(swappedSource, {
    filename: filePath,
    sourceFileName: absolutePath,
    sourceMaps: true,
    jsc: {
      target: "esnext",
      parser: { syntax: "typescript", tsx: true, decorators: true },
      experimental: {
        cacheRoot: "node_modules/.cache/swc",
        disableBuiltinTransformsForInternalTesting: true,
        disableAllLints: true,
        plugins: [[EXTRACTOR_PLUGIN, { isDevelopment, filePath }]],
      },
    },
  });

  // `output` is a JSON string whose `results` field is itself JSON.
  const output = JSON.parse((result as { output?: string }).output ?? "{}") as {
    results?: string;
  };
  const messages = (JSON.parse(output.results ?? "[]") as ExtractorResult[])
    .filter((item) => item.type === "extracted")
    .map(({ id, message, reference }) => ({ id, message, reference }));

  return {
    code: result.code.replaceAll(EXTRACTOR_SERVER_SPECIFIER, APP_EXTRACTED_SPECIFIER),
    map: result.map,
    messages,
  };
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(entryPath);
      }
      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
    }),
  );
  return files.flat();
}

function compareReferences(a: MessageReference, b: MessageReference) {
  return a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;
}

async function readCatalog(filePath: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Windows reports a file briefly held by a reader (watcher, editor) as one of these. */
const TRANSIENT_WRITE_ERRORS = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN"]);

async function writeIfChanged(filePath: string, content: string) {
  const previous = await readFile(filePath, "utf8").catch(() => null);
  if (previous === content) {
    return;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await writeFile(filePath, content);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !TRANSIENT_WRITE_ERRORS.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

/**
 * Compiles `useExtracted()` / `getExtracted()` inline messages to catalog keys
 * with next-intl's SWC extractor (the same hashes the catalogs already use) and
 * keeps `messages/*.json` in sync: the source locale is rewritten from source
 * code, other locales keep their translations, gain `""` for new messages and
 * drop unused ones.
 */
export function extractMessages(options: ExtractMessagesOptions): Plugin {
  let projectRoot = process.cwd();
  let isDevelopment = false;
  const messagesByFile = new Map<string, { source: string; messages: ExtractedMessage[] }>();
  let pendingSave: Promise<void> | null = null;
  // Client and SSR environments start builds concurrently; one writer at a time.
  let saveQueue: Promise<void> = Promise.resolve();

  // Keyed by content, not mtime: a save written in two steps within one
  // millisecond would otherwise keep the half-written version's messages.
  async function extractFile(absolutePath: string) {
    const source = await readFile(absolutePath, "utf8");
    if (messagesByFile.get(absolutePath)?.source === source) {
      return;
    }
    const messages = usesExtraction(source)
      ? (await compile(projectRoot, absolutePath, source, isDevelopment)).messages
      : [];
    messagesByFile.set(absolutePath, { source, messages });
  }

  function saveCatalogs() {
    const run = saveQueue.then(writeCatalogs);
    saveQueue = run.catch(() => undefined);
    return run;
  }

  async function writeCatalogs() {
    const first = new Map<string, ExtractedMessage>();
    for (const { messages } of messagesByFile.values()) {
      for (const message of messages) {
        const existing = first.get(message.id);
        if (!existing || compareReferences(message.reference, existing.reference) < 0) {
          first.set(message.id, message);
        }
      }
    }
    const ordered = [...first.values()].toSorted((a, b) =>
      compareReferences(a.reference, b.reference),
    );

    const messagesDir = path.resolve(projectRoot, options.messagesPath);
    await Promise.all(
      options.locales.map(async (locale) => {
        const catalogPath = path.join(messagesDir, `${locale}.json`);
        const existing = locale === options.sourceLocale ? {} : await readCatalog(catalogPath);
        const catalog: Record<string, string> = {};
        for (const { id, message } of ordered) {
          catalog[id] = locale === options.sourceLocale ? message : (existing[id] ?? "");
        }
        await writeIfChanged(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
      }),
    );
  }

  async function extractAll() {
    const srcDir = path.resolve(projectRoot, options.srcPath);
    const files = await listSourceFiles(srcDir);
    const fileSet = new Set(files);
    for (const known of messagesByFile.keys()) {
      if (!fileSet.has(known)) messagesByFile.delete(known);
    }
    await Promise.all(files.map(extractFile));
    await saveCatalogs();
  }

  function scheduleSave() {
    // A failed save during dev must not take the server down; the next edit retries.
    pendingSave ??= Promise.resolve().then(async () => {
      pendingSave = null;
      await saveCatalogs().catch((error: unknown) => {
        console.error("[extract-messages] could not update message catalogs", error);
      });
    });
  }

  function isSourceFile(absolutePath: string) {
    const srcDir = path.resolve(projectRoot, options.srcPath);
    return (
      absolutePath.startsWith(srcDir + path.sep) &&
      SOURCE_EXTENSIONS.has(path.extname(absolutePath)) &&
      !absolutePath.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part))
    );
  }

  return {
    name: "deni:extract-messages",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      isDevelopment = config.command === "serve";
    },
    async buildStart() {
      if (options.writeCatalogs === false) return;
      // Runs once per Vite environment; unchanged files are skipped by content.
      await extractAll();
    },
    configureServer(server) {
      if (options.writeCatalogs === false) return;
      const onChange = (filePath: string) => {
        const absolutePath = path.resolve(filePath);
        if (!isSourceFile(absolutePath)) return;
        void extractFile(absolutePath).then(scheduleSave, () => undefined);
      };
      const onUnlink = (filePath: string) => {
        if (messagesByFile.delete(path.resolve(filePath))) scheduleSave();
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onUnlink);
    },
    async transform(code, id) {
      const [filePath = id] = id.split("?");
      if (!usesExtraction(code) || !isSourceFile(path.resolve(filePath))) {
        return null;
      }
      const result = await compile(projectRoot, path.resolve(filePath), code, isDevelopment);
      return { code: result.code, map: result.map ?? null };
    },
  };
}
