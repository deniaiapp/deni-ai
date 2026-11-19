ALTER TABLE "billing" ADD COLUMN "payment_method_fingerprint" text;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "trial_payment_method_fingerprint" text;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "trial_used_at" timestamp;