ALTER TABLE "billing" ADD COLUMN "max_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "max_mode_usage_basic" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "max_mode_usage_premium" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "max_mode_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "stripe_metered_subscription_item_id" text;