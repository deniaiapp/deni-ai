DROP INDEX "billing_customer_idx";--> statement-breakpoint
DROP INDEX "billing_subscription_idx";--> statement-breakpoint
CREATE INDEX "billing_customer_idx" ON "billing" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_idx" ON "billing" USING btree ("stripe_subscription_id");