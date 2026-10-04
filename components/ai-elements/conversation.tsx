"use client";

import { ArrowDownIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn(
      "mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-8",
      className,
    )}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => {
  const t = useExtracted();
  const resolvedTitle = title ?? t("No messages yet");
  const resolvedDescription = description ?? t("Start a conversation to see messages here");
  return (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon ? <div className="text-neutral-109">{icon}</div> : null}
        <div className="space-y-1">
          <h3 className="font-medium text-sm text-foreground">{resolvedTitle}</h3>
          {resolvedDescription ? <p className="text-sm text-muted-foreground">{resolvedDescription}</p> : null}
        </div>
      </>
    )}
  </div>
  );
};

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button
      type="button"
      variant="outline"
      shape="square"
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-surface-input shadow-lg",
        className,
      )}
      onClick={handleScrollToBottom}
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};
