import type { db } from "@/db/drizzle";
import { cancellationFeedback } from "@/db/schema";
import type { normalizeCancellationFeedback } from "./cancellation-feedback";

/**
 * Stores a cancel survey answer. The subscription is already canceled by then,
 * so a failed write is logged instead of failing the cancellation.
 */
export async function recordCancellationFeedback(
  database: Pick<typeof db, "insert">,
  values: {
    userId: string;
    organizationId?: string | null;
    stripeSubscriptionId: string | null;
    planId: string | null;
    feedback: ReturnType<typeof normalizeCancellationFeedback>;
  },
) {
  const { feedback, ...rest } = values;
  if (!feedback) return;
  try {
    await database.insert(cancellationFeedback).values({
      ...rest,
      organizationId: rest.organizationId ?? null,
      reason: feedback.reason,
      comment: feedback.comment,
    });
  } catch (error) {
    console.error("[billing] Failed to record cancellation feedback", error);
  }
}
