import type { ComponentProps } from "react";

import { Button } from "@deniai/ui/components/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="instant"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

const STICK_TO_BOTTOM_TOLERANCE_PX = 2;

// use-stick-to-bottom only follows content resizes. When the scroll viewport
// itself shrinks or grows (for example while the composer expands), keep the
// bottom pinned in the same frame so the latest message neither slides under
// the composer nor reads as a user scroll that breaks the lock.
function useStickToBottomOnViewportResize() {
  const { scrollRef, state } = useStickToBottomContext();

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    let previousHeight = scrollElement.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = scrollElement.clientHeight;
      if (height === previousHeight) {
        return;
      }
      const difference = height - previousHeight;
      // Measure against the previous viewport height. A viewport resize keeps
      // scrollHeight, and a shrinking viewport leaves scrollTop untouched.
      const wasAtBottom =
        scrollElement.scrollHeight - previousHeight - scrollElement.scrollTop <=
        STICK_TO_BOTTOM_TOLERANCE_PX;
      previousHeight = height;
      // `escapedFromLock` can stay set after "scroll to bottom" re-locks, so
      // follow the library's own `isAtBottom` lock like its content resizes do.
      if (!state.isAtBottom && !wasAtBottom) {
        return;
      }

      // A growing viewport makes the browser clamp scrollTop, which the library
      // would read as the user scrolling up. Flag the resize the same way the
      // library does for content resizes so that scroll event is ignored.
      state.resizeDifference = difference;
      state.scrollTop = state.calculatedTargetScrollTop;
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (state.resizeDifference === difference) {
            state.resizeDifference = 0;
          }
        }, 1);
      });
    });
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollRef, state]);
}

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => {
  useStickToBottomOnViewportResize();

  return <StickToBottom.Content className={cn("flex flex-col gap-8 p-4", className)} {...props} />;
};

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "data" | "tool";
  content: string;
}

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  messages: ConversationMessage[];
  filename?: string;
  formatMessage?: (message: ConversationMessage, index: number) => string;
};

const defaultFormatMessage = (message: ConversationMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${message.content}`;
};

export const messagesToMarkdown = (
  messages: ConversationMessage[],
  formatMessage: (message: ConversationMessage, index: number) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
