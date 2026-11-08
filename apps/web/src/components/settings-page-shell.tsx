import type { ReactNode } from "react";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@deniai/ui/components/page-header";
import { cn } from "@/lib/utils";

type SettingsPageShellProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A settings page: `PageHeader` plus the page body (usually `PageSection`s). */
export function SettingsPageShell({
  title,
  description,
  actions,
  children,
  className,
}: SettingsPageShellProps) {
  return (
    <div className={cn("flex w-full flex-col", className)}>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>{title}</PageHeaderTitle>
          {description ? <PageHeaderDescription>{description}</PageHeaderDescription> : null}
        </PageHeaderHeading>
        {actions ? <PageHeaderActions>{actions}</PageHeaderActions> : null}
      </PageHeader>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
