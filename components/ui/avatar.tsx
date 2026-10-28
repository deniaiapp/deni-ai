import { avatarCharacter, characterImage, isAvatarImage } from "@/lib/avatar";

export function Avatar({ name, accent, icon }: { name: string; accent: string; icon?: string | null }) {
  const character = icon ? avatarCharacter(icon) : null;
  const image = icon && isAvatarImage(icon) ? icon : null;
  // Characters are drawn without a background, so they stand on their own instead of in a filled circle.
  if (character) return <span className="mt-0.5 flex h-8 w-8 shrink-0"><img src={characterImage(character)} alt="" draggable={false} className="size-full" /></span>;
  return <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs text-white" style={{ background: accent }}>
    {image ? <img src={image} alt="" draggable={false} className="size-full object-cover" /> : icon && !icon.startsWith("character:") ? <span className="text-xl leading-none">{icon}</span> : name.slice(0, 1)}
  </span>;
}
