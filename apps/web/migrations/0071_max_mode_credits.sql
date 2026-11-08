CREATE TABLE "max_mode_credit_account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"auto_top_up_enabled" boolean DEFAULT false NOT NULL,
	"auto_top_up_threshold_credits" integer DEFAULT 5 NOT NULL,
	"auto_top_up_amount_credits" integer DEFAULT 10 NOT NULL,
	"payment_method_id" text,
	"last_auto_top_up_at" timestamp,
	"last_auto_top_up_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "max_mode_credit_account_owner_check" CHECK ((user_id IS NULL) <> (organization_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "max_mode_credit_lot" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"source" text NOT NULL,
	"granted_units" bigint NOT NULL,
	"remaining_units" bigint NOT NULL,
	"revoked_units" bigint DEFAULT 0 NOT NULL,
	"amount_paid" integer NOT NULL,
	"currency" text NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_checkout_session_id" text,
	"purchased_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "max_mode_credit_lot_owner_check" CHECK ((user_id IS NULL) <> (organization_id IS NULL)),
	CONSTRAINT "max_mode_credit_lot_units_check" CHECK (remaining_units >= 0 AND remaining_units <= granted_units)
);
--> statement-breakpoint
ALTER TABLE "max_mode_credit_account" ADD CONSTRAINT "max_mode_credit_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "max_mode_credit_lot" ADD CONSTRAINT "max_mode_credit_lot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "max_mode_credit_account_user_idx" ON "max_mode_credit_account" USING btree ("user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "max_mode_credit_account_organization_idx" ON "max_mode_credit_account" USING btree ("organization_id") WHERE organization_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "max_mode_credit_lot_payment_intent_idx" ON "max_mode_credit_lot" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "max_mode_credit_lot_user_idx" ON "max_mode_credit_lot" USING btree ("user_id","expires_at") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "max_mode_credit_lot_organization_idx" ON "max_mode_credit_lot" USING btree ("organization_id","expires_at") WHERE organization_id IS NOT NULL;--> statement-breakpoint
DROP TABLE "max_mode_meter_event" CASCADE;--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "max_mode_usage_basic";--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "max_mode_usage_premium";--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "max_mode_period_start";--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "stripe_metered_subscription_item_id";--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "stripe_metered_basic_item_id";--> statement-breakpoint
ALTER TABLE "billing" DROP COLUMN "stripe_metered_premium_item_id";
