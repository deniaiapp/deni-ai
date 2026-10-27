import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { attachmentFileName } from "@/lib/discord-attachments";
import { localizeError } from "@/lib/localize-error";
import {
  WEB_ATTACHMENT_DIR,
  WEB_ATTACHMENT_LIMIT,
  type MessageAttachment,
} from "@/lib/message-attachments";
import { limitOrResponse } from "@/lib/rate-limit";
import { writeWorkspaceBytes } from "@/lib/workspace";
import { getExtracted } from "@/i18n/server";

/** Saves one file from the message box to /inbox/web/ in the workspace, so the teammate can work with it. */
async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  // The same burst and daily limits as files sent through Discord, counted per file.
  const limited =
    (await limitOrResponse(userId, "web-upload", 10, 10 * 60_000)) ??
    (await limitOrResponse(userId, "web-upload-day", 50, 24 * 60 * 60_000));
  if (limited) return limited;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: t("Choose a file to attach") }, { status: 400 });
  }
  if (file.size > WEB_ATTACHMENT_LIMIT) {
    return Response.json({ error: t("Files must be 10 MB or smaller") }, { status: 413 });
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const suffix = crypto.randomUUID().slice(0, 8);
  try {
    const saved = await writeWorkspaceBytes(
      userId,
      `${WEB_ATTACHMENT_DIR}/${stamp}-${suffix}-${attachmentFileName(file.name)}`,
      new Uint8Array(await file.arrayBuffer()),
      file.type || "application/octet-stream",
    );
    const attachment: MessageAttachment = {
      path: saved.path,
      name: file.name,
      size: saved.bytes,
      mediaType: file.type || "application/octet-stream",
    };
    return Response.json(attachment);
  } catch (error) {
    return Response.json({ error: await localizeError(error) }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/attachments")({
  server: { handlers: { POST } },
});
