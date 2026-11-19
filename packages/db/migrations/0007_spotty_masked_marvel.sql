CREATE TABLE "custom_model" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"model_id" text NOT NULL,
	"description" text,
	"premium" boolean DEFAULT false NOT NULL,
	"input_price_micros" integer,
	"output_price_micros" integer,
	"reasoning_price_micros" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_setting" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"prefer_byok" boolean DEFAULT false NOT NULL,
	"base_url" text,
	"api_style" text DEFAULT 'responses' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_model" ADD CONSTRAINT "custom_model_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_setting" ADD CONSTRAINT "provider_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_model_user_model_unique" ON "custom_model" USING btree ("user_id","provider","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_setting_user_provider_idx" ON "provider_setting" USING btree ("user_id","provider");