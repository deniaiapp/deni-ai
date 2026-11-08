import { useExtracted } from "use-intl";
import { useId, useState } from "react";
import {
  CANCELLATION_COMMENT_MAX_LENGTH,
  CANCELLATION_REASONS,
  type CancellationFeedback,
  type CancellationReason,
} from "@/lib/cancellation-feedback";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deniai/ui/components/alert-dialog";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@deniai/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@deniai/ui/components/radio-group";
import { Textarea } from "@deniai/ui/components/textarea";

function useCancellationReasonLabel() {
  const t = useExtracted();
  return (reason: CancellationReason) => {
    switch (reason) {
      case "too_expensive":
        return t("It's too expensive");
      case "unused":
        return t("I don't use it enough");
      case "missing_features":
        return t("It's missing features I need");
      case "low_quality":
        return t("The answers aren't good enough");
      case "switched_service":
        return t("I'm switching to another service");
      case "too_complex":
        return t("It's too hard to use");
      case "other":
        return t("Something else");
    }
  };
}

function isCancellationReason(value: unknown): value is CancellationReason {
  return CANCELLATION_REASONS.includes(value as CancellationReason);
}

/**
 * Asks before cancelling, with an optional survey on why. Open the shredder only
 * from `onConfirm`: it cancels the subscription as soon as it mounts.
 */
export function SubscriptionCancelDialog({
  open,
  onOpenChange,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  onConfirm: (feedback: CancellationFeedback) => void;
}) {
  const t = useExtracted();
  const getReasonLabel = useCancellationReasonLabel();
  const id = useId();
  const [reason, setReason] = useState<CancellationReason | null>(null);
  const [comment, setComment] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setReason(null);
      setComment("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Cancel subscription?")}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <FieldSet className="gap-4">
          <FieldLegend variant="label" className="mb-0">
            {t("Why are you canceling? (optional)")}
          </FieldLegend>
          <RadioGroup
            className="gap-2.5"
            value={reason}
            onValueChange={(value) => setReason(isCancellationReason(value) ? value : null)}
          >
            {CANCELLATION_REASONS.map((option) => (
              <Field key={option} orientation="horizontal">
                <RadioGroupItem id={`${id}-${option}`} value={option} />
                <FieldLabel htmlFor={`${id}-${option}`} className="font-normal">
                  {getReasonLabel(option)}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-comment`}>
              {t("Anything we could do better? (optional)")}
            </FieldLabel>
            <Textarea
              id={`${id}-comment`}
              className="max-h-40"
              maxLength={CANCELLATION_COMMENT_MAX_LENGTH}
              placeholder={t("Tell us more")}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
        </FieldSet>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Keep subscription")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              const feedback: CancellationFeedback = {
                ...(reason ? { reason } : {}),
                ...(comment.trim() ? { comment: comment.trim() } : {}),
              };
              handleOpenChange(false);
              onConfirm(feedback);
            }}
          >
            {t("Cancel subscription")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
