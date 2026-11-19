CREATE TABLE "affiliate_profile" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"reset_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_referral" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"code" text NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"purchase_deadline_at" timestamp NOT NULL,
	"purchase_plan_id" text,
	"purchase_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_reward" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" text NOT NULL,
	"referral_id" text,
	"type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"milestone" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan_id" text,
	"coupon_code" text,
	"note" text,
	"approved_by" text,
	"approved_at" timestamp,
	"sent_by" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_profile" ADD CONSTRAINT "affiliate_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_referral" ADD CONSTRAINT "affiliate_referral_referrer_id_user_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_referral" ADD CONSTRAINT "affiliate_referral_referred_user_id_user_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_reward" ADD CONSTRAINT "affiliate_reward_referrer_id_user_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_reward" ADD CONSTRAINT "affiliate_reward_referral_id_affiliate_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."affiliate_referral"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_profile_user_id_idx" ON "affiliate_profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_profile_code_idx" ON "affiliate_profile" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_referral_referred_user_id_idx" ON "affiliate_referral" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "affiliate_referral_referrer_id_idx" ON "affiliate_referral" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "affiliate_referral_code_idx" ON "affiliate_referral" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_reward_referrer_type_milestone_idx" ON "affiliate_reward" USING btree ("referrer_id","type","milestone");--> statement-breakpoint
CREATE INDEX "affiliate_reward_status_idx" ON "affiliate_reward" USING btree ("status");--> statement-breakpoint
CREATE INDEX "affiliate_reward_referral_id_idx" ON "affiliate_reward" USING btree ("referral_id");