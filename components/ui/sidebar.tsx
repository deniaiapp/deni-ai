"use client";

import { Loader2Icon, PanelLeftIcon, XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

function SidebarProvider({
  defaultOpen = true,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  return (
    <SidebarContext.Provider value={value}>
      <div data-slot="sidebar-provider" className={cn("flex h-full w-full", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, children, ...props }: ComponentProps<"aside">) {
  const { open, setOpen } = useSidebar();

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}
      <aside
        data-slot="sidebar"
        data-state={open ? "open" : "closed"}
        className={cn(
          "fixed inset-y-0 left-0 z-40 h-full w-[280px] shrink-0 -translate-x-full overflow-hidden transition-transform duration-200 ease-out",
          "data-[state=open]:translate-x-0",
          "md:static md:z-auto md:w-0 md:translate-x-0 md:data-[state=open]:w-[280px]",
          className,
        )}
        {...props}
      >
        <div className="flex h-full w-[280px] flex-col">{children}</div>
      </aside>
    </>
  );
}

function SidebarTrigger({ className, ...props }: ComponentProps<"button">) {
  const { toggle } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Toggle sidebar"
      onClick={toggle}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
        className,
      )}
      {...props}
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}

function SidebarClose({ className, ...props }: ComponentProps<"button">) {
  const { setOpen } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Close sidebar"
      onClick={() => setOpen(false)}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
        className,
      )}
      {...props}
    >
      <XIcon className="size-4" />
    </button>
  );
}

function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex items-center px-3 py-3", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3",
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex items-center px-3 py-3", className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cn("px-3 py-1", className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "px-2 pb-1.5 text-xs font-medium tracking-wide text-neutral-119 uppercase",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-menu" className={cn("flex flex-col gap-0.5", className)} {...props} />
  );
}

type SidebarMenuButtonProps = ComponentProps<"button"> & {
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  loading?: boolean;
};

function SidebarMenuButton({
  className,
  icon: Icon,
  loading = false,
  disabled,
  children,
  ...props
}: SidebarMenuButtonProps) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      disabled={disabled || loading}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-secondary-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : Icon ? (
        <Icon size={16} className="shrink-0" />
      ) : null}
      {children}
    </button>
  );
}

function SidebarMenuBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
};
