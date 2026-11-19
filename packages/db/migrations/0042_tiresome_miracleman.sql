ALTER TABLE "blog_post" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "blog_post_featured_status_idx" ON "blog_post" USING btree ("featured","status");