import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";

/**
 * Settings frame: a section nav beside the page on wide screens, a horizontal
 * scroller above it below `lg`. Compose `SettingsNav` (with `SettingsNavGroup`
 * / `SettingsNavItem`, optional `SettingsNavFooter`) and `SettingsContent`.
 */
function SettingsLayout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-layout"
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start lg:gap-10",
        className,
      )}
      {...props}
    />
  );
}

function SettingsNav({ className, children, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="settings-nav"
      className={cn(
        "-mx-4 shrink-0 overflow-x-auto px-4 lg:sticky lg:top-4 lg:mx-0 lg:w-56 lg:overflow-visible lg:px-0",
        className,
      )}
      {...props}
    >
      <div className="flex w-max gap-1 lg:w-full lg:flex-col lg:gap-5">{children}</div>
    </nav>
  );
}

function SettingsNavGroup({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<"div"> & { label?: React.ReactNode }) {
  return (
    <div
      data-slot="settings-nav-group"
      role="group"
      className={cn("flex gap-1 lg:flex-col lg:gap-0.5", className)}
      {...props}
    >
      {label ? (
        <div className="hidden px-3 pb-1 text-xs font-medium text-muted-foreground lg:block">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function SettingsNavItem({
  className,
  active = false,
  render,
  ...props
}: useRender.ComponentProps<"a"> & { active?: boolean }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        "aria-current": active ? "page" : undefined,
        className: cn(
          "relative flex h-9 shrink-0 items-center gap-2.5 rounded-button px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-(--duration-fast)",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "aria-[current=page]:bg-secondary aria-[current=page]:font-medium aria-[current=page]:text-secondary-foreground",
          // A leading bar marks the current page without relying on colour alone.
          "next:aria-[current=page]:before:absolute next:aria-[current=page]:before:inset-y-2 next:aria-[current=page]:before:left-0 next:aria-[current=page]:before:w-[3px] next:aria-[current=page]:before:rounded-full next:aria-[current=page]:before:bg-primary",
          "[&_svg]:size-4 [&_svg]:shrink-0",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "settings-nav-item", active },
  });
}

function SettingsNavFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-nav-footer"
      className={cn("hidden border-t border-border pt-4 lg:block", className)}
      {...props}
    />
  );
}

function SettingsContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-content"
      className={cn("flex w-full max-w-[52rem] min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

export {
  SettingsContent,
  SettingsLayout,
  SettingsNav,
  SettingsNavFooter,
  SettingsNavGroup,
  SettingsNavItem,
};
