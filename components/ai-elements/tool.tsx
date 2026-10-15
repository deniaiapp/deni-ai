import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useExtracted } from "@/i18n/react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full rounded-xl border border-foreground/10 bg-surface", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | { type: DynamicToolUIPart["type"]; state: DynamicToolUIPart["state"]; toolName: string }
);

function useStatusLabels(): Record<ToolPart["state"], string> {
  const t = useExtracted();
  return {
    "approval-requested": t("Awaiting approval"),
    "approval-responded": t("Responded"),
    "input-available": t("Running"),
    "input-streaming": t("Pending"),
    "output-available": t("Completed"),
    "output-denied": t("Denied"),
    "output-error": t("Error"),
  };
}

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-3.5 text-warning-400" />,
  "approval-responded": <CheckCircleIcon className="size-3.5 text-sky-400" />,
  "input-available": <ClockIcon className="size-3.5 animate-pulse text-warning-400" />,
  "input-streaming": <CircleIcon className="size-3.5 text-muted-foreground" />,
  "output-available": <CheckCircleIcon className="size-3.5 text-success-400" />,
  "output-denied": <XCircleIcon className="size-3.5 text-orange-400" />,
  "output-error": <XCircleIcon className="size-3.5 text-destructive-400" />,
};

function StatusBadge({ status }: { status: ToolPart["state"] }) {
  const statusLabels = useStatusLabels();
  return (
    <Badge variant="outline" className="gap-1.5 text-xs">
      {statusIcons[status]}
      {statusLabels[status]}
    </Badge>
  );
}

export const getStatusBadge = (status: ToolPart["state"]) => <StatusBadge status={status} />;

export const ToolHeader = ({ className, title, type, state, toolName, ...props }: ToolHeaderProps) => {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-sm text-foreground">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-3 border-t border-foreground/10 px-3 py-3 text-neutral-231 outline-none",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="scroll-thin max-h-64 overflow-auto rounded-lg bg-surface-9 p-3 text-xs whitespace-pre-wrap text-secondary-foreground">
      {children}
    </pre>
  );
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-1.5", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
    <Pre>{JSON.stringify(input, null, 2)}</Pre>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  const t = useExtracted();
  if (!(output || errorText)) return null;

  let body: ReactNode;
  if (typeof output === "string") {
    body = <Pre>{output}</Pre>;
  } else if (typeof output === "object" && output !== null && !isValidElement(output)) {
    body = <Pre>{JSON.stringify(output, null, 2)}</Pre>;
  } else {
    body = <div className="text-sm">{output as ReactNode}</div>;
  }

  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? t("Error") : t("Result")}
      </h4>
      <div className={cn(errorText ? "text-destructive-300" : undefined)}>
        {errorText ? <Pre>{errorText}</Pre> : body}
      </div>
    </div>
  );
};
