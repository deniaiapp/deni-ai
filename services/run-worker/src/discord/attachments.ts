import "@tanstack/react-start/server-only";

import { writeWorkspaceBytes } from "../computer/workspace";

/** Discord lets bots receive files up to this size; the workspace accepts the same. */
export const ATTACHMENT_LIMIT = 10_000_000;
const ATTACHMENT_COUNT = 10;

export type IncomingAttachment = { name: string; url: string; size: number; contentType: string | null };

/** A name that is safe as one path segment and still recognizable. */
export function attachmentFileName(name: string) {
  const cleaned = name.normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim();
  return (cleaned || "file").slice(-100);
}

/**
 * Save files sent in a Discord DM to /inbox/discord/ in the workspace, so the teammate can work
 * with them. Each gets a timestamp prefix, so sending the same name twice keeps both.
 */
export async function saveDiscordAttachments(userId: string, attachments: IncomingAttachment[], now = new Date()) {
  const saved: string[] = [];
  const skipped: { name: string; reason: "size" | "count" | "download" }[] = [];
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  for (const [index, attachment] of attachments.entries()) {
    if (index >= ATTACHMENT_COUNT) {
      skipped.push({ name: attachment.name, reason: "count" });
      continue;
    }
    if (attachment.size > ATTACHMENT_LIMIT) {
      skipped.push({ name: attachment.name, reason: "size" });
      continue;
    }
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > ATTACHMENT_LIMIT) {
        skipped.push({ name: attachment.name, reason: "size" });
        continue;
      }
      const file = await writeWorkspaceBytes(
        userId,
        `inbox/discord/${stamp}-${index + 1}-${attachmentFileName(attachment.name)}`,
        data,
        attachment.contentType ?? "application/octet-stream",
      );
      saved.push(file.path);
    } catch {
      skipped.push({ name: attachment.name, reason: "download" });
    }
  }
  return { saved, skipped };
}
