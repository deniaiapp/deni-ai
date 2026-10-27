import type { ChatStatus } from "ai";
import { CornerDownLeftIcon, ImageIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useExtracted } from "@/i18n/react";
import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  RefObject,
} from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  WEB_ATTACHMENT_COUNT,
  WEB_ATTACHMENT_LIMIT,
  type MessageAttachment,
} from "@/lib/message-attachments";
import { cn } from "@/lib/utils";

// ============================================================================
// Attachments
// ============================================================================

/** A file picked in the message box. It is saved to the workspace as soon as it is added. */
export type PromptInputFile = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  previewUrl?: string;
  uploadStatus: "uploading" | "uploaded" | "error";
  uploadError?: string;
  saved?: MessageAttachment;
};

export type PromptInputMessage = {
  text: string;
  files: MessageAttachment[];
};

type AttachmentsContext = {
  files: PromptInputFile[];
  isUploading: boolean;
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const context = useContext(LocalAttachmentsContext);
  if (!context) {
    throw new Error("usePromptInputAttachments must be used within a PromptInput");
  }
  return context;
};

async function uploadAttachment(file: File): Promise<MessageAttachment> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/attachments", { method: "POST", body });
  if (!response.ok) {
    // Rate limits answer with plain text; other failures with { error }.
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // Plain text body.
    }
    throw new Error(message || response.statusText);
  }
  return (await response.json()) as MessageAttachment;
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label,
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const t = useExtracted();
  const attachments = usePromptInputAttachments();

  return (
    <DropdownMenuItem
      {...props}
      onClick={(event) => {
        event.preventDefault();
        attachments.openFileDialog();
      }}
    >
      <ImageIcon className="size-4" /> {label ?? t("Add photos or files")}
    </DropdownMenuItem>
  );
};

// ============================================================================
// PromptInput
// ============================================================================

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
  multiple?: boolean;
  /** When true, files dropped anywhere on the page are attached. */
  globalDrop?: boolean;
  /** 0 turns attachments off. */
  maxFiles?: number;
  onError?: (message: string) => void;
  /** Return false when the message was not sent, so the attachments stay. */
  onSubmit: (message: PromptInputMessage) => boolean | void;
};

export const PromptInput = ({
  className,
  multiple,
  globalDrop,
  maxFiles = WEB_ATTACHMENT_COUNT,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const t = useExtracted();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [files, setFiles] = useState<PromptInputFile[]>([]);
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList];
      const sized = incoming.filter((file) => file.size <= WEB_ATTACHMENT_LIMIT);
      if (sized.length < incoming.length) {
        onError?.(t("Files must be 10 MB or smaller"));
      }
      // Decided outside the state updater: updaters must stay pure, and each
      // file here starts an upload and owns a blob URL.
      const capacity = Math.max(0, maxFiles - filesRef.current.length);
      const capped = sized.slice(0, capacity);
      if (sized.length > capacity) {
        onError?.(t("You can attach up to {count} files", { count: String(maxFiles) }));
      }
      if (capped.length === 0) {
        return;
      }

      const next = capped.map((file) => ({
        file,
        item: {
          id: crypto.randomUUID(),
          name: file.name,
          mediaType: file.type,
          size: file.size,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
          uploadStatus: "uploading",
        } satisfies PromptInputFile,
      }));
      setFiles((current) => [...current, ...next.map(({ item }) => item)]);
      for (const { file, item } of next) {
        void uploadAttachment(file)
          .then((saved) => {
            setFiles((current) =>
              current.map((entry) =>
                entry.id === item.id ? { ...entry, saved, uploadStatus: "uploaded" } : entry,
              ),
            );
          })
          .catch((error: unknown) => {
            setFiles((current) =>
              current.map((entry) =>
                entry.id === item.id
                  ? {
                      ...entry,
                      uploadStatus: "error",
                      uploadError: error instanceof Error ? error.message : t("Upload failed"),
                    }
                  : entry,
              ),
            );
          });
      }
    },
    [maxFiles, onError, t],
  );

  const remove = useCallback((id: string) => {
    setFiles((current) => {
      const found = current.find((file) => file.id === id);
      if (found?.previewUrl) {
        URL.revokeObjectURL(found.previewUrl);
      }
      return current.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setFiles((current) => {
      for (const file of current) {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      }
      return [];
    });
  }, []);

  const openFileDialog = useCallback(() => inputRef.current?.click(), []);

  useEffect(() => {
    if (maxFiles === 0) {
      return;
    }
    const target: HTMLElement | Document | null = globalDrop ? document : formRef.current;
    if (!target) {
      return;
    }
    const onDragOver = (event: Event) => {
      if ((event as DragEvent).dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    };
    const onDrop = (event: Event) => {
      const transfer = (event as DragEvent).dataTransfer;
      if (transfer?.types?.includes("Files")) {
        event.preventDefault();
      }
      if (transfer?.files && transfer.files.length > 0) {
        add(transfer.files);
      }
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop, maxFiles]);

  useEffect(
    () => () => {
      for (const file of filesRef.current) {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      }
    },
    [],
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      // Reset so a file that was removed can be picked again.
      event.currentTarget.value = "";
    },
    [add],
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      if (files.some((file) => file.uploadStatus === "uploading")) {
        onError?.(t("Attachments are still uploading"));
        return;
      }
      const text = String(new FormData(event.currentTarget).get("message") ?? "");
      const saved = files.flatMap((file) => (file.saved ? [file.saved] : []));
      if (onSubmit({ text, files: saved }) !== false) {
        clear();
      }
    },
    [files, onSubmit, onError, clear, t],
  );

  const context = useMemo<AttachmentsContext>(
    () => ({
      files,
      isUploading: files.some((file) => file.uploadStatus === "uploading"),
      add: maxFiles === 0 ? () => undefined : add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
    }),
    [files, add, remove, clear, openFileDialog, maxFiles],
  );

  return (
    <LocalAttachmentsContext.Provider value={context}>
      <input
        aria-label={t("Upload files")}
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title={t("Upload files")}
        type="file"
      />
      <form className={cn("w-full", className)} onSubmit={handleSubmit} ref={formRef} {...props}>
        <div
          data-slot="input-group"
          role="group"
          className="relative flex h-auto w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-transparent bg-input/50 transition-[color,box-shadow,background-color] outline-none has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30"
        >
          {children}
        </div>
      </form>
    </LocalAttachmentsContext.Provider>
  );
};

// ============================================================================
// Textarea
// ============================================================================

export type PromptInputTextareaProps = ComponentProps<"textarea">;

export const PromptInputTextarea = ({
  onKeyDown,
  className,
  placeholder,
  ...props
}: PromptInputTextareaProps) => {
  const t = useExtracted();
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Enter") {
        if (isComposing || event.nativeEvent.isComposing || event.shiftKey) {
          return;
        }
        // On touch-only devices, Enter inserts a newline; the send button submits.
        if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
          return;
        }
        event.preventDefault();
        const { form } = event.currentTarget;
        const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (submitButton?.disabled) {
          return;
        }
        // While a response is generating the submit button turns into Stop, so
        // Enter must not send a second message.
        if (form?.querySelector('[data-generating="true"]')) {
          return;
        }
        form?.requestSubmit();
      }

      // Backspace in an empty box removes the last attachment.
      if (
        event.key === "Backspace" &&
        event.currentTarget.value === "" &&
        attachments.files.length > 0
      ) {
        event.preventDefault();
        const last = attachments.files.at(-1);
        if (last) {
          attachments.remove(last.id);
        }
      }
    },
    [onKeyDown, isComposing, attachments],
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const files: File[] = [];
      for (const item of event.clipboardData?.items ?? []) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments],
  );

  return (
    <textarea
      data-slot="input-group-control"
      className={cn(
        "field-sizing-content max-h-48 min-h-16 w-full flex-1 resize-none rounded-none border-0 bg-transparent text-base shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      enterKeyHint="enter"
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder ?? t("What would you like to do?")}
      {...props}
    />
  );
};

// ============================================================================
// Layout
// ============================================================================

const addonClassName =
  "flex h-auto w-full cursor-text items-center justify-start gap-2 px-3 pb-3 text-sm font-medium text-muted-foreground select-none [&>svg:not([class*='size-'])]:size-4";

export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <div
    data-slot="input-group-addon"
    className={cn(addonClassName, "order-first flex-wrap gap-1 py-2 empty:hidden", className)}
    {...props}
  />
);

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <div
    data-slot="input-group-addon"
    className={cn(addonClassName, "justify-between gap-1 py-2", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
  variant = "ghost",
  size = "icon-sm",
  className,
  ...props
}: PromptInputButtonProps) => (
  <Button
    className={cn("shadow-none", className)}
    size={size}
    type="button"
    variant={variant}
    {...props}
  />
);

// ============================================================================
// Action menu
// ============================================================================

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;

export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => {
  const t = useExtracted();
  return (
    <DropdownMenuTrigger
      render={<PromptInputButton aria-label={t("More options")} className={className} {...props} />}
    >
      {children ?? <PlusIcon className="size-4" />}
    </DropdownMenuTrigger>
  );
};

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>;

export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" side="top" className={cn(className)} {...props} />
);

// ============================================================================
// Submit
// ============================================================================

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const t = useExtracted();
  const attachments = usePromptInputAttachments();
  const isGenerating = status === "submitted" || status === "streaming";
  const isUploading = attachments.isUploading;

  let icon = <CornerDownLeftIcon className="size-4" />;
  if (isUploading || status === "submitted") {
    icon = <Spinner size="sm" className="text-current" />;
  } else if (status === "streaming") {
    icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    icon = <XIcon className="size-4" />;
  }

  return (
    <Button
      aria-label={isGenerating ? t("Stop") : isUploading ? t("Uploading") : t("Send")}
      className={cn(className)}
      data-generating={isGenerating && onStop ? "true" : undefined}
      disabled={disabled || (!isGenerating && isUploading)}
      onClick={(event) => {
        if (isGenerating && onStop) {
          event.preventDefault();
          onStop();
          return;
        }
        onClick?.(event);
      }}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? icon}
    </Button>
  );
};
