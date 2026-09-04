"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function ContextMenu({ ...props }: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1c] p-1 text-[#ececec] shadow-xl outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & {
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] outline-none select-none",
        "text-[#e8e8e8] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[#9a9a9a]",
        "focus:bg-[#2d2d2d] data-[highlighted]:bg-[#2d2d2d]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        "data-[variant=destructive]:text-[#e07070] data-[variant=destructive]:[&_svg]:text-[#e07070]",
        "data-[variant=destructive]:focus:bg-red-500/10 data-[variant=destructive]:data-[highlighted]:bg-red-500/10",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("mx-1 my-1 h-px bg-white/10", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
};
