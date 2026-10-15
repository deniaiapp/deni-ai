import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseSync } from "vite";
import { locales, sourceLocale } from "./config.ts";
import { messageId } from "./message-id.ts";
import { parsePo, serializePo, type PoCatalog, type PoEntry } from "./po.ts";

// Collects every message passed to a translator from useExtracted(), getExtracted(), or
// headTranslator() and syncs messages/*.po: new messages are added (translated to themselves in
// the source locale and left empty elsewhere), unused ones are dropped, and existing translations
// are kept.

export const extractConfig = {
  srcPaths: ["app", "components", "lib"],
  messagesDir: "messages",
};

const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const translatorFactories = new Set(["useExtracted", "getExtracted", "headTranslator"]);
const translatorMethods = new Set(["rich", "markup", "has"]);

type Node = { type: string; [key: string]: unknown };
type Extracted = { message: string; reference: string };

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

function walk(node: unknown, visit: (node: Node) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || typeof value !== "object" || value === null) continue;
    walk(value, visit);
  }
}

function unwrap(node: unknown): unknown {
  let current = node;
  while (isNode(current) && (current.type === "AwaitExpression" || current.type === "TSAsExpression" || current.type === "ParenthesizedExpression")) {
    current = current.type === "AwaitExpression" ? current.argument : current.expression;
  }
  return current;
}

function staticString(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const [quasi] = node.quasis as Node[];
    return (quasi.value as { cooked: string }).cooked;
  }
  return undefined;
}

/** Messages in one file. Only translators bound by name in that file are followed. */
export function extractFromSource(file: string, code: string): string[] {
  if (![...translatorFactories].some((name) => code.includes(name))) return [];
  const { program, errors } = parseSync(file, code, { lang: file.endsWith("x") ? "tsx" : "ts" });
  if (errors.length > 0) throw new Error(`Could not parse ${file}: ${errors[0].message}`);

  const translators = new Set<string>();
  walk(program, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const init = unwrap(node.init);
    const id = node.id as Node;
    if (!isNode(init) || init.type !== "CallExpression" || id.type !== "Identifier") return;
    const callee = init.callee as Node;
    if (callee.type === "Identifier" && translatorFactories.has(callee.name as string)) {
      translators.add(id.name as string);
    }
  });
  if (translators.size === 0) return [];

  const messages: string[] = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as Node;
    const target =
      callee.type === "Identifier"
        ? callee
        : callee.type === "MemberExpression" &&
            !callee.computed &&
            translatorMethods.has(((callee.property as Node).name as string) ?? "")
          ? (callee.object as Node)
          : undefined;
    if (!target || target.type !== "Identifier" || !translators.has(target.name as string)) return;
    if (callee.type === "MemberExpression" && (callee.property as Node).name === "has") return;
    const message = staticString((node.arguments as unknown[])[0]);
    if (message !== undefined) messages.push(message);
  });
  return messages;
}

async function sourceFiles(root: string, dir: string): Promise<string[]> {
  const entries = (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) =>
    compareText(a.name, b.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, relative)));
    else if (sourceFile.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(relative);
  }
  return files;
}

export async function collectMessages(root: string): Promise<Extracted[]> {
  const found: Extracted[] = [];
  for (const dir of extractConfig.srcPaths) {
    for (const file of await sourceFiles(root, dir)) {
      const code = await readFile(path.join(root, file), "utf8");
      for (const message of extractFromSource(file, code)) found.push({ message, reference: file });
    }
  }
  return found;
}

function mergeCatalog(existing: PoCatalog | undefined, locale: string, found: Extracted[]): PoCatalog {
  const previous = new Map(existing?.entries.map((entry) => [entry.id, entry]));
  const byId = new Map<string, PoEntry>();
  for (const { message, reference } of found) {
    const id = messageId(message);
    let entry = byId.get(id);
    if (!entry) {
      const translation = locale === sourceLocale ? message : (previous.get(id)?.translation ?? "");
      entry = { id, message, translation, references: [] };
      byId.set(id, entry);
    }
    if (!entry.references.includes(reference)) entry.references.push(reference);
  }
  const entries = [...byId.values()];
  for (const entry of entries) entry.references.sort();
  // Stable sort, so messages from the same file stay in source order.
  entries.sort((a, b) => compareText(a.references[0], b.references[0]));
  return {
    headers: existing?.headers ?? [`Language: ${locale}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "X-Message-Key: msgctxt"],
    entries,
  };
}

/** Rewrites the catalogs that changed. Returns the locales that were written. */
export async function extractMessages(root: string): Promise<string[]> {
  const found = await collectMessages(root);
  const written: string[] = [];
  for (const locale of locales) {
    const file = path.join(root, extractConfig.messagesDir, `${locale}.po`);
    const current = await readFile(file, "utf8").catch(() => undefined);
    const next = serializePo(mergeCatalog(current === undefined ? undefined : parsePo(current), locale, found));
    if (next === current?.replace(/\r\n/g, "\n")) continue;
    await writeFile(file, next);
    written.push(locale);
  }
  return written;
}
