import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  collectWorkspaceFiles,
  deleteWorkspaceContents,
  deleteWorkspacePath,
  deleteWorkspacePaths,
  listWorkspace,
  readWorkspaceBytes,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/lib/workspace";
import { createZip } from "@/lib/zip";
import { attachmentDisposition } from "@/lib/download";

export const dynamic = "force-dynamic";

const MAX_ZIP_FILES = 100;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50_000_000;

function downloadName(path: string) {
  return path.replace(/^\/+/, "").split("/").at(-1) || "file";
}

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") || ".";
  const mode = url.searchParams.get("mode") || "list";
  try {
    if (mode === "read") {
      return NextResponse.json(await readWorkspaceFile(userId, rel));
    }
    if (mode === "download") {
      const file = await readWorkspaceBytes(userId, rel);
      return new NextResponse(new Uint8Array(file.data), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": attachmentDisposition(downloadName(file.path)),
        },
      });
    }
    return NextResponse.json({ tree: await listWorkspace(userId, rel, 3) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function PUT(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { path?: string; content?: string };
  if (!body.path || body.content == null) {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await writeWorkspaceFile(userId, body.path, body.content));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { action?: string; paths?: string[] };
  if (body.action !== "zip") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }
  try {
    const listed = await collectWorkspaceFiles(userId, body.paths ?? []);
    if (listed.length === 0) {
      return NextResponse.json({ error: "No files to download" }, { status: 400 });
    }
    if (listed.length > MAX_ZIP_FILES) {
      return NextResponse.json(
        { error: `Too many files to download (maximum ${MAX_ZIP_FILES})` },
        { status: 400 },
      );
    }
    const listedBytes = listed.reduce((total, item) => total + item.size, 0);
    if (listedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      return NextResponse.json(
        {
          error: `Files are too large to download together (maximum ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes)`,
        },
        { status: 400 },
      );
    }
    const entries = [];
    let totalBytes = 0;
    for (const item of listed) {
      const file = await readWorkspaceBytes(userId, item.path);
      totalBytes += file.data.byteLength;
      if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Files are too large to download together (maximum ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes)`,
        );
      }
      entries.push({ name: item.path, data: file.data });
    }
    const zip = createZip(entries);
    const label =
      body.paths?.length === 1 ? downloadName(body.paths[0] ?? "workspace") : "workspace";
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentDisposition(`${label}.zip`),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  const body = (await req.json().catch(() => ({}))) as { paths?: string[]; all?: boolean };
  try {
    if (body.all) return NextResponse.json(await deleteWorkspaceContents(userId));
    if (body.paths?.length) return NextResponse.json(await deleteWorkspacePaths(userId, body.paths));
    if (rel) return NextResponse.json(await deleteWorkspacePath(userId, rel));
    return NextResponse.json({ error: "path required" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
