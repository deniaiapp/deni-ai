CREATE TABLE "team_member_usage_policy" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"max_mode_enabled" boolean DEFAULT true NOT NULL,
	"max_mode_limit_basic" integer,
	"max_mode_limit_premium" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_member_usage_policy" ADD CONSTRAINT "team_member_usage_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_usage_policy" ADD CONSTRAINT "team_member_usage_policy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_usage_policy_org_user_idx" ON "team_member_usage_policy" USING btree ("organization_id","user_id");