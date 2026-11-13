-- The drizzle migrator creates the schema for its journal before running this.
CREATE SCHEMA IF NOT EXISTS "support";
--> statement-breakpoint
CREATE TABLE "support"."conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lang" text NOT NULL,
	"page_path" text,
	"email" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_request_at" timestamp with time zone,
	"last_staff_reply_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "support"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"request" jsonb,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support"."message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "support"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_last_request_at_idx" ON "support"."conversation" USING btree ("last_request_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_conversation_created_idx" ON "support"."message" USING btree ("conversation_id","created_at");