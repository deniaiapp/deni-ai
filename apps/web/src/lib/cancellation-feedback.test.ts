import { expect, test } from "vitest";
import {
  CANCELLATION_COMMENT_MAX_LENGTH,
  cancellationFeedbackSchema,
  normalizeCancellationFeedback,
  toStripeCancellationDetails,
} from "./cancellation-feedback";

test("a skipped survey records nothing and sends no Stripe details", () => {
  expect(normalizeCancellationFeedback(undefined)).toBeNull();
  expect(normalizeCancellationFeedback({ comment: "   " })).toBeNull();
  expect(toStripeCancellationDetails(null)).toBeUndefined();
});

test("a reason and comment become Stripe cancellation details", () => {
  const feedback = normalizeCancellationFeedback(
    cancellationFeedbackSchema.parse({ reason: "too_expensive", comment: "  pricey  " }),
  );
  expect(feedback).toEqual({ reason: "too_expensive", comment: "pricey" });
  expect(toStripeCancellationDetails(feedback)).toEqual({
    feedback: "too_expensive",
    comment: "pricey",
  });
});

test("a comment alone is kept without a reason", () => {
  const feedback = normalizeCancellationFeedback({ comment: "Just testing" });
  expect(feedback).toEqual({ reason: null, comment: "Just testing" });
  expect(toStripeCancellationDetails(feedback)).toEqual({ comment: "Just testing" });
});

test("unknown reasons and overlong comments are rejected", () => {
  expect(cancellationFeedbackSchema.safeParse({ reason: "customer_service" }).success).toBe(false);
  expect(
    cancellationFeedbackSchema.safeParse({
      comment: "x".repeat(CANCELLATION_COMMENT_MAX_LENGTH + 1),
    }).success,
  ).toBe(false);
});
