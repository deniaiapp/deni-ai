import { FileTextIcon, ImageIcon, Music2Icon, PaperclipIcon, VideoIcon, XIcon } from "lucide-react";
import { useExtracted } from "@/i18n/react";
import type { ComponentProps, HTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type AttachmentData = {
  name: string;
  mediaType: string;
  previewUrl?: string;
  uploadStatus?: "uploading" | "uploaded" | "error";
  uploadError?: string;
};

function MediaIcon({ mediaType }: { mediaType: string }) {
  const className = "size-3 text-muted-foreground";
  if (mediaType.startsWith("image/")) return <ImageIcon className={className} />;
  if (mediaType.startsWith("video/")) return <VideoIcon className={className} />;
  if (mediaType.startsWith("audio/")) return <Music2Icon className={className} />;
  if (mediaType.startsWith("text/") || mediaType === "application/pdf") {
    return <FileTextIcon className={className} />;
  }
  return <PaperclipIcon className={className} />;
}

export type AttachmentsProps = HTMLAttributes<HTMLDivElement>;

/** A row of file chips, as in the message box and under a sent message. */
export const Attachments = ({ className, ...props }: AttachmentsProps) => (
  <div className={cn("flex flex-wrap items-start gap-2", className)} {...props} />
);

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export const Attachment = ({ data, onRemove, className, ...props }: AttachmentProps) => {
  const t = useExtracted();

  return (
    <div
      className={cn(
        "group relative flex min-h-8 max-w-60 select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-foreground text-sm transition-all",
        "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        data.uploadStatus === "error" && "border-destructive/40",
        className,
      )}
      title={data.uploadStatus === "error" ? data.uploadError : data.name}
      {...props}
    >
      <div className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-background">
        {data.previewUrl ? (
          <img alt="" className="size-full object-cover" src={data.previewUrl} />
        ) : (
          <MediaIcon mediaType={data.mediaType} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate">{data.name}</span>
        {data.uploadStatus === "error" && data.uploadError ? (
          <span className="block truncate text-destructive text-xs">{data.uploadError}</span>
        ) : null}
      </div>
      {data.uploadStatus === "uploading" ? <Spinner size="sm" className="size-3" /> : null}
      {onRemove ? (
        <AttachmentRemove label={t("Remove {name}", { name: data.name })} onClick={onRemove} />
      ) : null}
    </div>
  );
};

type AttachmentRemoveProps = ComponentProps<typeof Button> & { label: string };

const AttachmentRemove = ({ label, onClick, className, ...props }: AttachmentRemoveProps) => (
  <Button
    aria-label={label}
    className={cn(
      "size-5 rounded p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&>svg]:size-2.5",
      className,
    )}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    type="button"
    variant="ghost"
    {...props}
  >
    <XIcon />
  </Button>
);
