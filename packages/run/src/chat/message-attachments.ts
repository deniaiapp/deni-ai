import type { UIMessage } from "ai";

/** Files sent from the web message box are saved here, next to Discord's inbox/discord/. */
export const WEB_ATTACHMENT_DIR = "inbox/web";
/** The workspace stores files up to 10 MB, the same as files sent through Discord. */
export const WEB_ATTACHMENT_LIMIT = 10_000_000;
export const WEB_ATTACHMENT_COUNT = 10;

/** A file saved in the workspace and sent with a message. */
export type MessageAttachment = { path: string; name: string; size: number; mediaType: string };

/** Reads attachments from message metadata. The client sends them, so anything malformed is dropped. */
export function messageAttachments(message: UIMessage): MessageAttachment[] {
  const value = (message.metadata as { attachments?: unknown } | undefined)?.attachments;
  if (!Array.isArray(value)) return [];
  return value.slice(0, WEB_ATTACHMENT_COUNT).flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { path, name, size, mediaType } = item as Partial<MessageAttachment>;
    if (
      typeof path !== "string" ||
      !path.startsWith(`/${WEB_ATTACHMENT_DIR}/`) ||
      path.length > 300
    )
      return [];
    return [
      {
        path,
        name:
          typeof name === "string" && name ? name.slice(0, 200) : (path.split("/").at(-1) ?? path),
        size: typeof size === "number" && Number.isFinite(size) ? size : 0,
        mediaType:
          typeof mediaType === "string" ? mediaType.slice(0, 200) : "application/octet-stream",
      },
    ];
  });
}
