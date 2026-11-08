CREATE TABLE "beta_access" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"granted_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "beta_access_email_lowercase_check" CHECK ("beta_access"."email" = lower(trim("beta_access"."email")))
);
--> statement-breakpoint
ALTER TABLE "beta_access" ADD CONSTRAINT "beta_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_access" ADD CONSTRAINT "beta_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beta_access_email_unique" ON "beta_access" USING btree ("email");--> statement-breakpoint
CREATE INDEX "beta_access_user_id_idx" ON "beta_access" USING btree ("user_id");