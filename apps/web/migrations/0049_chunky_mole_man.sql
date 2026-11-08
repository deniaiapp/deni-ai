ALTER TABLE "ad_campaign" ADD COLUMN "weighted_impression_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaign" ADD COLUMN "weighted_click_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "ad_campaign" SET "weighted_impression_units" = "impressions" * 2, "weighted_click_units" = "clicks" * 2;