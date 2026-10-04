"use client";

import { PaperPlaneTiltIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ChatStatus } from "ai";
import { useExtracted } from "next-intl";
import type { ComponentProps, KeyboardEventHandler, MouseEvent } from "react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PromptInputProps = ComponentProps<"form">;

export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form className={cn("flex flex-col gap-2", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea> & {
  onSubmit?: () => void;
};

export const PromptInputTextarea = ({
  className,
  onSubmit,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) => {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSubmit?.();
      }
    },
    [onKeyDown, onSubmit],
  );

  return (
    <Textarea
      className={cn("min-h-18 max-h-56 w-full", className)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type PromptInputToolbarProps = ComponentProps<"div">;

export const PromptInputToolbar = ({ className, ...props }: PromptInputToolbarProps) => (
  <div className={cn("flex items-center justify-between gap-3", className)} {...props} />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const t = useExtracted();
  const isGenerating = status === "submitted" || status === "streaming";

  let icon = <PaperPlaneTiltIcon />;
  let label = t("Send");
  if (status === "submitted") {
    icon = <Spinner size="sm" />;
    label = t("Sending");
  } else if (status === "streaming") {
    icon = <StopIcon />;
    label = t("Stop");
  } else if (status === "error") {
    icon = <WarningCircleIcon />;
    label = t("Retry");
  }

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick],
  );

  return (
    <Button
      type={isGenerating && onStop ? "button" : "submit"}
      variant="primary"
      size="sm"
      className={className}
      onClick={handleClick}
      {...props}
    >
      {children ?? (
        <>
          {icon}
          {label}
        </>
      )}
    </Button>
  );
};
