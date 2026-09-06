import { isMessageReaction } from "./message-actions";

export function isAvatarImage(icon: string) { return /^data:image\/(?:png|jpeg|webp);base64,/.test(icon); }
export function validAvatarIcon(value: unknown): value is string | null {
  if (value === null || value === "") return true;
  return typeof value === "string" && value.length <= 50000 && (isMessageReaction(value) || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));
}
