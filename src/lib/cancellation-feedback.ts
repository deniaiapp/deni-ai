import type Stripe from "stripe";
import { z } from "zod";

/**
 * Reasons offered by the cancel survey. Each is also a Stripe
 * `cancellation_details.feedback` value, so the answer shows up in the Stripe
 * dashboard as well.
 */
export const CANCELLATION_REASONS = [
  "too_expensive",
  "unused",
  "missing_features",
  "low_quality",
  "switched_service",
  "too_complex",
  "other",
] as const satisfies readonly Stripe.SubscriptionUpdateParams.CancellationDetails.Feedback[];

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_COMMENT_MAX_LENGTH = 1000;

/** The survey is optional: both fields may be left out. */
export const cancellationFeedbackSchema = z.object({
  reason: z.enum(CANCELLATION_REASONS).optional(),
  comment: z.string().trim().max(CANCELLATION_COMMENT_MAX_LENGTH).optional(),
});

export type CancellationFeedback = z.infer<typeof cancellationFeedbackSchema>;

/** Drops blank answers; null when the survey was skipped. */
export function normalizeCancellationFeedback(
  feedback: CancellationFeedback | undefined,
): { reason: CancellationReason | null; comment: string | null } | null {
  const reason = feedback?.reason ?? null;
  const comment = feedback?.comment?.trim() || null;
  if (!reason && !comment) return null;
  return { reason, comment };
}

export function toStripeCancellationDetails(
  feedback: ReturnType<typeof normalizeCancellationFeedback>,
): Stripe.SubscriptionUpdateParams.CancellationDetails | undefined {
  if (!feedback) return undefined;
  return {
    ...(feedback.reason ? { feedback: feedback.reason } : {}),
    ...(feedback.comment ? { comment: feedback.comment } : {}),
  };
}
