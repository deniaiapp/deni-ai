import "server-only";

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceNode } from "./types";
import { jailPath, toWorkspacePath, userWorkspaceDir, userWorkspacePrefix } from "./paths";
import {
  deleteUserObjects,
  deleteUserObject,
  getUserObject,
  hasObjectStorage,
  listUserObjects,
  objectSuffixFromKey,
  putUserObject,
} from "./storage";
import { WORKSPACE_README } from "./seed";

const MAX_FILE_SIZE = 1_000_000;
const MAX_DOWNLOAD_FILE_SIZE = 10_000_000;

function normalizePath(relativePath: string) {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = cleaned.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || part.includes("\0"))) {
    throw new Error("Path is outside the workspace");
  }
  return parts.join("/");
}

async function ensureLocalWorkspace(userId: string) {
  const root = userWorkspaceDir(userId);
  await mkdir(path.join(root, "inbox"), { recursive: true });
  await mkdir(path.join(root, "projects"), { recursive: true });
  await mkdir(path.join(root, "outbox"), { recursive: true });
  const readme = path.join(root, "README.md");
  try {
    await readFile(readme);
  } catch {
    await writeFile(readme, WORKSPACE_README, "utf8");
  }
  return root;
}

async function ensureRemoteWorkspace(userId: string) {
  const objects = await listUserObjects(userId, "workspace/");
  if (objects.length === 0) {
    await putUserObject(userId, "workspace/README.md", WORKSPACE_README, "text/markdown");
  }
}

async function ensureWorkspace(userId: string) {
  const remote = hasObjectStorage();
  if (process.env.NODE_ENV === "production" && !remote) {
    throw new Error("S3-compatible workspace storage is required in production");
  }
  if (remote) {
    await ensureRemoteWorkspace(userId);
    return null;
  }
  return ensureLocalWorkspace(userId);
}

async function walkLocal(root: string, rel: string, depth: number): Promise<WorkspaceNode[]> {
  const dir = jailPath(rel, root);
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: WorkspaceNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitkeep") continue;
    const abs = path.join(dir, entry.name);
    const childRel = rel === "." ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: toWorkspacePath(abs, root),
        type: "dir",
        children: depth > 0 ? await walkLocal(root, childRel, depth - 1) : [],
      });
    } else {
      const info = await stat(abs);
      nodes.push({
        name: entry.name,
        path: toWorkspacePath(abs, root),
        type: "file",
        size: info.size,
      });
    }
  }
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function buildRemoteNodes(
  files: { path: string; size: number }[],
  base: string,
  depth: number,
): WorkspaceNode[] {
  const prefix = base ? `${base}/` : "";
  const children = new Map<string, { type: "file" | "dir"; size?: number }>();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (!rest) continue;
    const [name, ...remaining] = rest.split("/");
    if (remaining.length === 0) {
      children.set(name, { type: "file", size: file.size });
    } else if (!children.has(name)) {
      children.set(name, { type: "dir" });
    }
  }
  return [...children.entries()]
    .map(([name, item]) => {
      const child = base ? `${base}/${name}` : name;
      return {
        name,
        path: `/${child}`,
        type: item.type,
        size: item.size,
        children:
          item.type === "dir" && depth > 0
            ? buildRemoteNodes(files, child, depth - 1)
            : item.type === "dir"
              ? []
              : undefined,
      } satisfies WorkspaceNode;
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function listWorkspace(userId: string, rel = ".", depth = 3) {
  const normalized = normalizePath(rel);
  const root = await ensureWorkspace(userId);
  if (root) return walkLocal(root, normalized || ".", depth);
  const prefix = userWorkspacePrefix(userId);
  const objects = await listUserObjects(userId, "workspace/");
  const files = objects
    .map((item) => ({
      path: item.key.startsWith(prefix) ? item.key.slice(prefix.length) : "",
      size: item.size,
    }))
    .filter((item) => item.path && !item.path.endsWith("/.keep") && item.path !== ".keep");
  return buildRemoteNodes(files, normalized, depth);
}

export async function readWorkspaceFile(userId: string, rel: string) {
  const normalized = normalizePath(rel);
  if (!normalized) throw new Error("A file path is required");
  const root = await ensureWorkspace(userId);
  if (root) {
    const abs = jailPath(normalized, root);
    const info = await stat(abs);
    if (info.isDirectory()) {
      return { path: toWorkspacePath(abs, root), directory: true, content: "" };
    }
    if (info.size > MAX_FILE_SIZE) throw new Error("File is too large (maximum 1 MB)");
    return {
      path: toWorkspacePath(abs, root),
      directory: false,
      content: await readFile(abs, "utf8"),
    };
  }
  const body = await getUserObject(userId, `workspace/${normalized}`);
  if (!body) throw new Error("File not found");
  if (body.byteLength > MAX_FILE_SIZE) throw new Error("File is too large (maximum 1 MB)");
  return { path: `/${normalized}`, directory: false, content: body.toString("utf8") };
}

export async function writeWorkspaceFile(userId: string, rel: string, content: string) {
  const normalized = normalizePath(rel);
  if (!normalized) throw new Error("A file path is required");
  const root = await ensureWorkspace(userId);
  if (root) {
    const abs = jailPath(normalized, root);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  } else {
    await putUserObject(userId, `workspace/${normalized}`, content, "text/plain; charset=utf-8");
  }
  return { path: `/${normalized}`, bytes: Buffer.byteLength(content) };
}

export async function makeWorkspaceDir(userId: string, rel: string) {
  const normalized = normalizePath(rel);
  if (!normalized) throw new Error("A directory path is required");
  const root = await ensureWorkspace(userId);
  if (root) {
    await mkdir(jailPath(normalized, root), { recursive: true });
  } else {
    await putUserObject(userId, `workspace/${normalized}/.keep`, "", "application/octet-stream");
  }
  return { path: `/${normalized}` };
}

export async function listWorkspaceFiles(userId: string, prefix = "") {
  const normalized = normalizePath(prefix);
  const root = await ensureWorkspace(userId);
  if (root) {
    const start = jailPath(normalized || ".", root);
    const info = await stat(start).catch(() => null);
    if (!info) return [];
    if (info.isFile()) return [{ path: normalized, size: info.size }];
    const files: { path: string; size: number }[] = [];
    async function walk(rel: string) {
      const dir = jailPath(rel || ".", root!);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".gitkeep") continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(childRel);
        else {
          const stats = await stat(path.join(dir, entry.name));
          files.push({ path: childRel, size: stats.size });
        }
      }
    }
    await walk(normalized);
    return files;
  }

  const objects = await listUserObjects(
    userId,
    normalized ? `workspace/${normalized}` : "workspace/",
  );
  const prefixKey = userWorkspacePrefix(userId);
  return objects
    .map((item) => ({
      path: item.key.startsWith(prefixKey) ? item.key.slice(prefixKey.length) : "",
      size: item.size,
    }))
    .filter((item) => {
      if (!item.path || item.path.endsWith("/.keep") || item.path === ".keep") return false;
      if (!normalized) return true;
      return item.path === normalized || item.path.startsWith(`${normalized}/`);
    });
}

export async function readWorkspaceBytes(userId: string, rel: string) {
  const normalized = normalizePath(rel);
  if (!normalized) throw new Error("A file path is required");
  const root = await ensureWorkspace(userId);
  if (root) {
    const abs = jailPath(normalized, root);
    const info = await stat(abs);
    if (info.isDirectory()) throw new Error("Path is a directory");
    if (info.size > MAX_DOWNLOAD_FILE_SIZE) throw new Error("File is too large to download");
    return { path: `/${normalized}`, name: path.basename(normalized), data: await readFile(abs) };
  }
  const body = await getUserObject(userId, `workspace/${normalized}`);
  if (!body) throw new Error("File not found");
  if (body.byteLength > MAX_DOWNLOAD_FILE_SIZE) throw new Error("File is too large to download");
  return { path: `/${normalized}`, name: path.basename(normalized), data: body };
}

export async function collectWorkspaceFiles(userId: string, rels: string[]) {
  const targets = rels.length > 0 ? rels : [""];
  const seen = new Set<string>();
  const files: { path: string; size: number }[] = [];
  for (const rel of targets) {
    for (const file of await listWorkspaceFiles(userId, rel)) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
  }
  return files;
}

export async function deleteWorkspacePaths(userId: string, rels: string[]) {
  const unique = [...new Set(rels.map((rel) => normalizePath(rel)).filter(Boolean))].sort(
    (a, b) => a.length - b.length,
  );
  const deleted: string[] = [];
  for (const rel of unique) {
    await deleteWorkspacePath(userId, rel);
    deleted.push(`/${rel}`);
  }
  return { deleted };
}

export async function deleteWorkspaceContents(userId: string) {
  const files = await listWorkspaceFiles(userId);
  const top = new Set<string>();
  for (const file of files) top.add(file.path.split("/")[0] ?? file.path);
  return deleteWorkspacePaths(userId, [...top]);
}

export async function deleteWorkspacePath(userId: string, rel: string) {
  const normalized = normalizePath(rel);
  if (!normalized) throw new Error("The workspace root cannot be deleted");
  const root = await ensureWorkspace(userId);
  if (root) {
    await rm(jailPath(normalized, root), { recursive: true, force: true });
  } else {
    const objects = await listUserObjects(userId, `workspace/${normalized}/`);
    const suffixes = objects
      .map((item) => objectSuffixFromKey(userId, item.key))
      .filter((suffix): suffix is string => Boolean(suffix));
    if (suffixes.length > 0) await deleteUserObjects(userId, suffixes);
    await deleteUserObject(userId, `workspace/${normalized}`);
  }
  return { path: `/${normalized}`, deleted: true };
}

export async function prepareCommandWorkspace(userId: string) {
  const root = await ensureLocalWorkspace(userId);
  if (!hasObjectStorage()) return root;
  const prefix = userWorkspacePrefix(userId);
  const objects = await listUserObjects(userId, "workspace/");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const object of objects) {
    if (!object.key.startsWith(prefix) || object.key.endsWith("/.keep")) continue;
    const rel = object.key.slice(prefix.length);
    const body = await getUserObject(userId, `workspace/${rel}`);
    if (!body) continue;
    const destination = jailPath(rel, root);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);
  }
  return root;
}

export async function syncCommandWorkspace(userId: string, root: string) {
  if (!hasObjectStorage()) return;
  const existing = await listUserObjects(userId, "workspace/");
  const oldSuffixes = existing
    .map((item) => objectSuffixFromKey(userId, item.key))
    .filter((suffix): suffix is string => Boolean(suffix));
  await deleteUserObjects(userId, oldSuffixes);
  const files: string[] = [];
  async function collect(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(abs);
      else files.push(abs);
    }
  }
  await collect(root);
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    await putUserObject(
      userId,
      `workspace/${rel}`,
      await readFile(file),
      "application/octet-stream",
    );
  }
}
