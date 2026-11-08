ALTER TABLE "affiliate_referral" ADD COLUMN "claim_ip_hash" text;--> statement-breakpoint
ALTER TABLE "affiliate_reward" ADD COLUMN "risk_score" integer;--> statement-breakpoint
ALTER TABLE "affiliate_reward" ADD COLUMN "risk_flags" jsonb DEFAULT '[]';--> statement-breakpoint
CREATE INDEX "affiliate_referral_claim_ip_hash_idx" ON "affiliate_referral" USING btree ("claim_ip_hash");