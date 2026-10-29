CREATE TABLE "team_domain" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_domain_policy" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"join_mode" text DEFAULT 'request' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_join_request" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_domain" ADD CONSTRAINT "team_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_domain_policy" ADD CONSTRAINT "team_domain_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_request" ADD CONSTRAINT "team_join_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_request" ADD CONSTRAINT "team_join_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_request" ADD CONSTRAINT "team_join_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_domain_org_domain_idx" ON "team_domain" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "team_domain_verified_domain_idx" ON "team_domain" USING btree ("domain") WHERE "team_domain"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_domain_policy_organization_idx" ON "team_domain_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_join_request_org_user_idx" ON "team_join_request" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "team_join_request_user_idx" ON "team_join_request" USING btree ("user_id");