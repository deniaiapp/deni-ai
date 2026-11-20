import { randomBytes } from "node:crypto";
import { writeWorkspaceBytes } from "../computer/workspace";
import { attachmentFileName } from "../discord/attachments";
import {
  WEB_ATTACHMENT_DIR,
  WEB_ATTACHMENT_LIMIT,
  type MessageAttachment,
} from "./message-attachments";

/**
 * Save a file sent from the web message box to /inbox/web/ in the workspace, so the teammate
 * can work with it. The name gets a timestamp and a random part, so sending the same name twice
 * keeps both. The returned record goes into the message's `metadata.attachments`.
 */
export async function saveWebAttachment(
  userId: string,
  file: { name: string; data: Uint8Array; mediaType?: string | null },
  now = new Date(),
): Promise<MessageAttachment> {
  if (file.data.byteLength > WEB_ATTACHMENT_LIMIT) throw new Error("File is too large to upload");
  const name = attachmentFileName(file.name);
  const mediaType = file.mediaType?.slice(0, 200) || "application/octet-stream";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const saved = await writeWorkspaceBytes(
    userId,
    `${WEB_ATTACHMENT_DIR}/${stamp}-${randomBytes(3).toString("hex")}-${name}`,
    file.data,
    mediaType,
  );
  return { path: saved.path, name, size: saved.bytes, mediaType };
}
