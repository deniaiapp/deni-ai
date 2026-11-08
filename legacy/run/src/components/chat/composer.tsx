import { useEffect, useRef, useState, type ReactNode } from "react";
import { Attachment, Attachments } from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
  type PromptInputProps,
  type PromptInputSubmitProps,
  type PromptInputTextareaProps,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";

export type ComposerMessage = PromptInputMessage;

// Menus render in portals; pointer and focus moves into them must not collapse the composer.
const COMPOSER_POPUP_SELECTOR =
  '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"]';

function ComposerAttachments() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments>
      {attachments.files.map((attachment) => (
        <Attachment
          data={attachment}
          key={attachment.id}
          onRemove={() => attachments.remove(attachment.id)}
        />
      ))}
    </Attachments>
  );
}

type ComposerProps = Pick<PromptInputProps, "globalDrop" | "multiple" | "onError"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Return false when the message was not sent, so the attachments stay. */
  onSubmit: (message: ComposerMessage) => boolean | void;
  onStop?: () => void;
  placeholder?: string;
  className?: string;
  textareaProps?: Omit<PromptInputTextareaProps, "value" | "placeholder">;
  actionMenuItems?: ReactNode;
  status?: PromptInputSubmitProps["status"];
  tools?: ReactNode;
  voiceInput?: ReactNode;
  bottomContent?: ReactNode;
  isSubmitDisabled?: boolean;
  attachmentsEnabled?: boolean;
};

/**
 * The message box from Deni AI: one row with the + menu, the text, voice input and send, and a
 * row of tools that opens while the box is in use.
 */
export function Composer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  onError,
  placeholder,
  className,
  textareaProps,
  actionMenuItems,
  status,
  tools,
  voiceInput,
  bottomContent,
  isSubmitDisabled,
  globalDrop,
  multiple,
  attachmentsEnabled = true,
}: ComposerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !containerRef.current?.contains(target) &&
        !target.closest(COMPOSER_POPUP_SELECTOR)
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, []);

  const isGenerating = status === "submitted" || status === "streaming";
  const disabled = isGenerating ? false : (isSubmitDisabled ?? !value.trim());

  return (
    <div
      ref={containerRef}
      className="w-full"
      onBlur={() => {
        // Portaled menus briefly move focus outside the composer while closing.
        // Check after focus restoration rather than collapsing on that transient blur.
        requestAnimationFrame(() => {
          const focused = document.activeElement;
          if (
            focused instanceof Element &&
            focused !== document.body &&
            !containerRef.current?.contains(focused) &&
            !focused.closest(COMPOSER_POPUP_SELECTOR)
          ) {
            setIsExpanded(false);
          }
        });
      }}
    >
      <PromptInput
        onSubmit={(message) => {
          const sent = onSubmit(message);
          if (sent !== false) setIsExpanded(false);
          return sent;
        }}
        onError={onError}
        className={cn("h-auto flex-col", className)}
        globalDrop={globalDrop}
        multiple={multiple}
        maxFiles={attachmentsEnabled ? undefined : 0}
      >
        <PromptInputHeader className="pt-2 pb-0">
          <ComposerAttachments />
        </PromptInputHeader>
        <div className={cn("flex w-full min-w-0 items-center gap-1 p-2", isExpanded && "pb-0")}>
          {attachmentsEnabled || actionMenuItems ? (
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger
                className="size-8 shrink-0 text-muted-foreground"
                onClick={() => setIsExpanded(true)}
              />
              <PromptInputActionMenuContent>
                {attachmentsEnabled && <PromptInputActionAddAttachments />}
                {actionMenuItems}
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          ) : null}
          <PromptInputTextarea
            {...textareaProps}
            onChange={(event) => {
              onValueChange(event.target.value);
              textareaProps?.onChange?.(event);
            }}
            onFocus={(event) => {
              setIsExpanded(true);
              textareaProps?.onFocus?.(event);
            }}
            onClick={(event) => {
              setIsExpanded(true);
              textareaProps?.onClick?.(event);
            }}
            onKeyDown={(event) => {
              textareaProps?.onKeyDown?.(event);
              if (!event.defaultPrevented && event.key === "Escape") {
                setIsExpanded(false);
                event.currentTarget.blur();
              }
            }}
            value={value}
            placeholder={placeholder}
            className={cn("min-h-8 min-w-0 flex-1 px-1 py-1.5 leading-5", textareaProps?.className)}
          />
          {voiceInput}
          <PromptInputSubmit
            className="shrink-0"
            disabled={disabled}
            status={status}
            onStop={onStop}
          />
        </div>
        {tools ? (
          <div
            className={cn(
              "grid w-full transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
              isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
            inert={!isExpanded}
            aria-hidden={!isExpanded}
          >
            <div className="min-h-0 overflow-hidden">
              <PromptInputFooter className="flex-wrap justify-start">
                <PromptInputTools className="flex-wrap">{tools}</PromptInputTools>
              </PromptInputFooter>
            </div>
          </div>
        ) : null}
        {bottomContent ? (
          <PromptInputFooter className="justify-start border-t pt-3">
            {bottomContent}
          </PromptInputFooter>
        ) : null}
      </PromptInput>
    </div>
  );
}
