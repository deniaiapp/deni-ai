CREATE TABLE "billing" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan_id" text,
	"price_id" text,
	"status" text DEFAULT 'inactive',
	"mode" text DEFAULT 'subscription',
	"current_period_end" timestamp,
	"checkout_session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing" ADD CONSTRAINT "billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_user_idx" ON "billing" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_idx" ON "billing" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_idx" ON "billing" USING btree ("stripe_subscription_id");