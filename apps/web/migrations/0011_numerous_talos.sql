DROP INDEX "billing_user_org_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_user_idx" ON "billing" USING btree ("user_id");