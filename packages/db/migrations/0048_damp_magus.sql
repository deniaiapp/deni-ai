CREATE TABLE "ad_campaign" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"review_reason" text,
	"budget_yen" integer NOT NULL,
	"spent_yen" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text,
	"checkout_expires_at" timestamp,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_event" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_campaign" ADD CONSTRAINT "ad_campaign_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_event" ADD CONSTRAINT "ad_event_campaign_id_ad_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaign_user_idx" ON "ad_campaign" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ad_campaign_delivery_idx" ON "ad_campaign" USING btree ("status","plan");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_event_campaign_kind_id_idx" ON "ad_event" USING btree ("campaign_id","kind","id");