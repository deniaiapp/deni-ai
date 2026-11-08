import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFreshSessionLocalization } from "@/hooks/use-fresh-session-localization";
import { FreshSessionPrompt } from "./fresh-session-prompt";

export type FreshSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
};

/**
 * Modal wrapper around `FreshSessionPrompt` for call sites where the re-auth
 * prompt should interrupt the user (e.g. after clicking a button) rather
 * than being shown inline.
 */
export function FreshSessionDialog({ open, onOpenChange, onVerified }: FreshSessionDialogProps) {
  const freshSessionLocalization = useFreshSessionLocalization();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{freshSessionLocalization.title}</DialogTitle>
          <DialogDescription>{freshSessionLocalization.description}</DialogDescription>
        </DialogHeader>

        <FreshSessionPrompt onVerified={onVerified} />
      </DialogContent>
    </Dialog>
  );
}
