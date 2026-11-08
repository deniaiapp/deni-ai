DROP INDEX "billing_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_user_personal_idx" ON "billing" USING btree ("user_id") WHERE organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_user_org_idx" ON "billing" USING btree ("user_id","organization_id") WHERE organization_id IS NOT NULL;