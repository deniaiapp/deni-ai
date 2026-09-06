"use client";

import { isAvatarImage } from "@/lib/avatar";

export function Avatar({ name, accent, icon }: { name: string; accent: string; icon?: string | null }) {
  return <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs text-white" style={{ background: accent }}>
    {icon && isAvatarImage(icon) ? <img src={icon} alt="" draggable={false} className="size-full object-cover" /> : icon ? <span className="text-xl leading-none">{icon}</span> : name.slice(0, 1)}
  </span>;
}
