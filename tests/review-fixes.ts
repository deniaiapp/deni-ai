import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachmentDisposition } from "../src/lib/download";
import { userWorkspacePrefix } from "../src/lib/data/paths";
import * as workspacePaths from "../src/lib/data/paths";
import { mockModules } from "./helpers/module-mocks";

async function main() {
  for (const name of ["資料.txt", "日本語.zip", 'a"b\\c.txt', "a\r\nb.txt", "😀.txt"]) {
    const value = attachmentDisposition(name);
    assert.doesNotThrow(() => new Response("", { headers: { "Content-Disposition": value } }));
    assert.match(value, /filename\*=UTF-8''/);
  }
  assert.ok(attachmentDisposition("資料.txt").endsWith(encodeURIComponent("資料.txt")));

  const root = await mkdtemp(path.join(tmpdir(), "deni-review-"));
  const store = {};
  let lock: Promise<unknown> = Promise.resolve();
  const objects = new Map<string, Buffer>();
  const prefix = userWorkspacePrefix("test");
  const restoreModules = mockModules((request, parentPath) => {
    if (request === "@tanstack/react-start/server-only") return {};
    if (request === "./store" || request.endsWith("/data/store"))
      return {
        readStore: async () => store,
        mutateStore: (_id: string, fn: (value: typeof store) => unknown) => {
          const next = lock.then(() => fn(store));
          lock = next.catch(() => undefined);
          return next;
        },
      };
    if (request === "../data/paths" && parentPath?.endsWith("workspace.ts"))
      return {
        ...workspacePaths,
        userDataDir: () => root,
        userWorkspaceDir: () => path.join(root, "workspace"),
      };
    if (request === "./storage" || request.endsWith("/data/storage"))
      return {
        hasObjectStorage: () => true,
        listUserObjects: async (_id: string, suffix: string) =>
          [...objects]
            .filter(([key]) => key.startsWith(suffix))
            .map(([key, body]) => ({
              key: prefix.replace(/workspace\/$/, "") + key,
              size: body.length,
              etag: body.toString("hex"),
            })),
        objectSuffixFromKey: (_id: string, key: string) =>
          key.slice(prefix.length - "workspace/".length),
        getUserObject: async (_id: string, key: string) => objects.get(key) ?? null,
        putUserObject: async (_id: string, key: string, body: Buffer) => {
          objects.set(key, Buffer.from(body));
        },
        deleteUserObject: async (_id: string, key: string) => {
          objects.delete(key);
        },
        deleteUserObjects: async (_id: string, keys: string[]) => {
          for (const key of keys) objects.delete(key);
        },
      };
    return undefined;
  });
  try {
    const { prepareCommandWorkspace, syncCommandWorkspace } =
      await import("../src/lib/computer/workspace");
    objects.set("workspace/old.txt", Buffer.from("before"));
    objects.set("workspace/remove.txt", Buffer.from("remove"));
    objects.set("workspace/.config", Buffer.from("hidden"));
    const cwd = await prepareCommandWorkspace("test");
    await writeFile(path.join(cwd, "old.txt"), "after");
    await rm(path.join(cwd, "remove.txt"));
    await mkdir(path.join(cwd, "nested"));
    await writeFile(path.join(cwd, "nested", "new.txt"), "new");
    await syncCommandWorkspace("test", cwd);
    assert.equal(objects.get("workspace/old.txt")?.toString(), "after");
    assert.equal(objects.get("workspace/nested/new.txt")?.toString(), "new");
    assert.equal(objects.has("workspace/remove.txt"), false);
    assert.equal(objects.get("workspace/.config")?.toString(), "hidden");
    const conflictCwd = await prepareCommandWorkspace("test");
    await writeFile(path.join(conflictCwd, "old.txt"), "local change");
    objects.set("workspace/old.txt", Buffer.from("concurrent remote change"));
    await assert.rejects(syncCommandWorkspace("test", conflictCwd), /Workspace changed/);
    assert.equal(objects.get("workspace/old.txt")?.toString(), "concurrent remote change");
    console.log(
      "verified Unicode downloads and workspace synchronization",
    );
  } finally {
    restoreModules();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
