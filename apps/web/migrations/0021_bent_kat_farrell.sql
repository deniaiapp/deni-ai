CREATE TABLE "palette_image_cache" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"model" text NOT NULL,
	"aspect_ratio" text,
	"resolution" text,
	"number_of_images" integer NOT NULL,
	"images" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "palette_image_cache_key_idx" ON "palette_image_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "palette_image_cache_model_idx" ON "palette_image_cache" USING btree ("model");