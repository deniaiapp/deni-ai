import { cn } from "@deniai/ui/lib/utils";

const CHARACTER_PREFIX = "character:";
const CHARACTERS = ["navi", "loupe", "gear", "quill", "spark", "tally", "sprout", "luna"];

/** What a teammate icon value shows: a character, an uploaded image, an emoji, or the initial. */
export function teammateIconKind(icon: string | null | undefined) {
  if (!icon) return { kind: "initial" as const };
  if (icon.startsWith(CHARACTER_PREFIX)) {
    const name = icon.slice(CHARACTER_PREFIX.length);
    if (CHARACTERS.includes(name))
      return { kind: "image" as const, src: `/run/characters/${name}.svg` };
  }
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(icon))
    return { kind: "image" as const, src: icon };
  return { kind: "emoji" as const, value: icon };
}

export const TEAMMATE_CHARACTER_ICONS = CHARACTERS.map((name) => `${CHARACTER_PREFIX}${name}`);

/**
 * A teammate's (or group's) picture. The accent colour is teammate data, so it is applied
 * as an inline ring colour on top of the semantic background.
 */
export function TeammateAvatar({
  name,
  icon,
  accent,
  size = "md",
  className,
}: {
  name: string;
  icon?: string | null;
  accent?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const shown = teammateIconKind(icon);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-foreground ring-2 ring-border",
        size === "sm" && "size-6 text-xs",
        size === "md" && "size-9 text-sm",
        size === "lg" && "size-14 text-xl",
        className,
      )}
      style={accent ? { ["--tw-ring-color" as string]: accent } : undefined}
    >
      {shown.kind === "image" ? (
        <img src={shown.src} alt="" className="size-full object-cover" />
      ) : shown.kind === "emoji" ? (
        <span>{shown.value}</span>
      ) : (
        <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
    </span>
  );
}
