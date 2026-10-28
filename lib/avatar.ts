import { isMessageReaction } from "./message-actions";

/**
 * Deni Run's own characters, screen-headed teammates a teammate or group can wear as its icon,
 * stored as `character:<id>`. The art is in public/characters/.
 */
export const AVATAR_CHARACTERS = ["navi", "loupe", "gear", "quill", "spark", "tally", "sprout", "luna"] as const;
export type AvatarCharacter = (typeof AVATAR_CHARACTERS)[number];

const CHARACTER_PREFIX = "character:";

export function characterIcon(character: AvatarCharacter) { return `${CHARACTER_PREFIX}${character}`; }
export function avatarCharacter(icon: string): AvatarCharacter | null {
  const id = icon.startsWith(CHARACTER_PREFIX) ? icon.slice(CHARACTER_PREFIX.length) : "";
  return (AVATAR_CHARACTERS as readonly string[]).includes(id) ? (id as AvatarCharacter) : null;
}
export function characterImage(character: AvatarCharacter) { return `/characters/${character}.svg`; }

export function isAvatarImage(icon: string) { return /^data:image\/(?:png|jpeg|webp);base64,/.test(icon); }
export function validAvatarIcon(value: unknown): value is string | null {
  if (value === null || value === "") return true;
  return typeof value === "string" && value.length <= 50000 && (isMessageReaction(value) || avatarCharacter(value) !== null || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));
}
