CREATE TABLE "memory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memory" RENAME COLUMN "content" TO "instructions";--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN "tone" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN "friendliness" text DEFAULT 'friendly' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN "warmth" text DEFAULT 'warm' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN "emoji_style" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN "auto_memory" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;