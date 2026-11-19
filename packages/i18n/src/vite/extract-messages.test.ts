import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
import { afterEach, beforeEach, expect, test } from "vitest";
import { extractMessages, type ExtractMessagesOptions } from "./extract-messages";

const COMPONENT = `import { useExtracted } from "use-intl";

export function Greeting({ name }: { name: string }) {
  const t = useExtracted();
  return <p>{t("Hello {name}", { name })}</p>;
}
`;

const ROUTE_HEAD = `import { getExtracted } from "@deniai/i18n/extracted";

export function head(intl: Parameters<typeof getExtracted>[0]) {
  const t = getExtracted(intl);
  return { title: t("Sign in required") };
}
`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "deni-extract-messages-"));
  await mkdir(path.join(root, "src", "routes"), { recursive: true });
  await mkdir(path.join(root, "messages"));
  await writeFile(path.join(root, "src", "greeting.tsx"), COMPONENT);
  await writeFile(path.join(root, "src", "routes", "head.ts"), ROUTE_HEAD);
  await writeFile(path.join(root, "src", "plain.ts"), "export const answer = 42;\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Hook = (...args: unknown[]) => unknown;

/** Calls a plugin hook the way Vite does (function or `{ handler }` form). */
function callHook(hook: Plugin[keyof Plugin], ...args: unknown[]): unknown {
  const handler = (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler) as Hook;
  return handler.call({}, ...args);
}

async function runBuild(overrides: Partial<ExtractMessagesOptions> = {}) {
  const plugin = extractMessages({
    srcPath: "./src",
    messagesPath: "./messages",
    sourceLocale: "en",
    locales: ["en", "ja"],
    ...overrides,
  });
  await callHook(plugin.configResolved, { root, command: "build" });
  await callHook(plugin.buildStart, {});
  return plugin;
}

async function readCatalog(locale: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
}

test("writes the source catalog from inline messages and seeds other locales", async () => {
  await runBuild();

  const en = await readCatalog("en");
  // Ordered by source reference: src/greeting.tsx before src/routes/head.ts.
  expect(Object.values(en)).toEqual(["Hello {name}", "Sign in required"]);
  const ja = await readCatalog("ja");
  expect(Object.keys(ja)).toEqual(Object.keys(en));
  expect(Object.values(ja)).toEqual(["", ""]);
});

test("keeps existing translations and drops unused keys", async () => {
  await runBuild();
  const [greetingId, signInId] = Object.keys(await readCatalog("en"));
  await writeFile(
    path.join(root, "messages", "ja.json"),
    JSON.stringify({ [signInId!]: "サインインが必要です", stale: "古い" }),
  );

  await runBuild();

  expect(await readCatalog("ja")).toEqual({
    [greetingId!]: "",
    [signInId!]: "サインインが必要です",
  });
});

test("leaves catalogs alone when writeCatalogs is false", async () => {
  await runBuild({ writeCatalogs: false });

  await expect(readFile(path.join(root, "messages", "en.json"), "utf8")).rejects.toThrow();
});

test("compiles getExtracted() to catalog keys and keeps the package import", async () => {
  const plugin = await runBuild();
  const [, signInId] = Object.keys(await readCatalog("en"));
  const id = path.join(root, "src", "routes", "head.ts");

  const result = (await callHook(plugin.transform, ROUTE_HEAD, id)) as { code: string };

  expect(result.code).toContain('from "@deniai/i18n/extracted"');
  expect(result.code).not.toContain("next-intl/server");
  expect(result.code).toContain("getTranslations");
  expect(result.code).toContain(JSON.stringify(signInId));
});

test("does not transform files outside srcPath or without inline messages", async () => {
  const plugin = await runBuild();

  expect(
    await callHook(plugin.transform, ROUTE_HEAD, path.join(root, "other", "head.ts")),
  ).toBeNull();
  expect(
    await callHook(
      plugin.transform,
      "export const answer = 42;\n",
      path.join(root, "src", "plain.ts"),
    ),
  ).toBeNull();
});
