import * as React from "react";
import { cn } from "cn";

/**
 * One row of a settings-style page. `aside` (default) puts the title and
 * description in a narrow column beside the content on wide screens; `stacked`
 * puts them above full-width content (tables, plan grids). Rows are separated
 * by hairlines instead of being boxed in cards.
 */
function PageSection({
  className,
  layout = "aside",
  ...props
}: React.ComponentProps<"section"> & { layout?: "aside" | "stacked" }) {
  return (
    <section
      data-slot="page-section"
      data-layout={layout}
      className={cn(
        "grid gap-4 border-t border-border py-6 first-of-type:border-t-0 first-of-type:pt-0",
        "data-[layout=aside]:lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] data-[layout=aside]:lg:gap-10",
        className,
      )}
      {...props}
    />
  );
}

function PageSectionHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-section-header"
      className={cn("flex min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function PageSectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="page-section-title"
      className={cn("text-base leading-6 font-semibold tracking-[-0.011em]", className)}
      {...props}
    />
  );
}

function PageSectionDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="page-section-description"
      className={cn("text-sm text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

function PageSectionContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-section-content"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  );
}

export {
  PageSection,
  PageSectionContent,
  PageSectionDescription,
  PageSectionHeader,
  PageSectionTitle,
};
