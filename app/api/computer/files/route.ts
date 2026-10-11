import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  deleteWorkspaceContents,
  deleteWorkspacePath,
  deleteWorkspacePaths,
  listWorkspace,
  readWorkspaceBytes,
  readWorkspaceFile,
  writeWorkspaceFile,
  zipWorkspaceFiles,
} from "@/lib/workspace";
import { attachmentDisposition } from "@/lib/download";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

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
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}

export async function PUT(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { path?: string; content?: string };
  if (!body.path || body.content == null) {
    return NextResponse.json({ error: t("Path and content are required") }, { status: 400 });
  }
  try {
    return NextResponse.json(await writeWorkspaceFile(userId, body.path, body.content));
  } catch (error) {
    return NextResponse.json(
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { action?: string; paths?: string[] };
  if (body.action !== "zip") {
    return NextResponse.json({ error: t("Unsupported action") }, { status: 400 });
  }
  try {
    const zip = await zipWorkspaceFiles(userId, body.paths ?? []);
    if (!zip.ok) {
      const error = zip.reason === "empty"
        ? t("No files to download")
        : zip.reason === "too_many"
          ? t("Too many files to download (maximum {max})", { max: String(zip.max) })
          : t("Files are too large to download together (maximum {max} bytes)", { max: String(zip.max) });
      return NextResponse.json({ error }, { status: 400 });
    }
    const label =
      body.paths?.length === 1 ? downloadName(body.paths[0] ?? "workspace") : "workspace";
    return new NextResponse(new Uint8Array(zip.data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentDisposition(`${label}.zip`),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  const body = (await req.json().catch(() => ({}))) as { paths?: string[]; all?: boolean };
  try {
    if (body.all) return NextResponse.json(await deleteWorkspaceContents(userId));
    if (body.paths?.length) return NextResponse.json(await deleteWorkspacePaths(userId, body.paths));
    if (rel) return NextResponse.json(await deleteWorkspacePath(userId, rel));
    return NextResponse.json({ error: t("Path is required") }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}
