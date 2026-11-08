import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useExtracted } from "use-intl";
import { toast } from "sonner";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function StreamdownLinkSafetyModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const t = useExtracted();
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef(0);

  useEffect(() => () => window.clearTimeout(copiedTimeoutRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("Link copied to clipboard"));
      window.clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("Copy failed. Select the link and copy it manually."));
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="size-5" />
            {t("Open external link?")}
          </DialogTitle>
          <DialogDescription>{t("You're about to visit an external website.")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <DialogFooter>
          <Button onClick={handleCopy} type="button" variant="outline">
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? t("Copied!") : t("Copy link")}
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            type="button"
          >
            <ExternalLink data-icon="inline-start" />
            {t("Open link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderStreamdownLinkSafetyModal(props: LinkSafetyModalProps) {
  return <StreamdownLinkSafetyModal {...props} />;
}

export const streamdownLinkSafety = {
  enabled: true,
  renderModal: renderStreamdownLinkSafetyModal,
} satisfies LinkSafetyConfig;
