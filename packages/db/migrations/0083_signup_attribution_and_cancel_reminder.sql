CREATE TABLE "signup_attribution" (
	"user_id" text PRIMARY KEY NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"referrer_host" text,
	"landing_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "cancel_reminder_sent_for" integer;--> statement-breakpoint
ALTER TABLE "signup_attribution" ADD CONSTRAINT "signup_attribution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_attribution_created_at_idx" ON "signup_attribution" USING btree ("created_at");