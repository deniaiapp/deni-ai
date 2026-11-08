CREATE TYPE "public"."blog_post_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "blog_post" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" "blog_post_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"title_ja" text DEFAULT '' NOT NULL,
	"description_ja" text DEFAULT '' NOT NULL,
	"body_ja" text DEFAULT '' NOT NULL,
	"author" text DEFAULT 'Deni AI team' NOT NULL,
	"published_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_post_slug_idx" ON "blog_post" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "blog_post_status_published_at_idx" ON "blog_post" USING btree ("status","published_at");