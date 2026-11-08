CREATE TYPE "public"."share_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "chat_share_recipients" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_shares" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"visibility" "share_visibility" DEFAULT 'public' NOT NULL,
	"allow_fork" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_share_recipients" ADD CONSTRAINT "chat_share_recipients_share_id_chat_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."chat_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_share_recipients" ADD CONSTRAINT "chat_share_recipients_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_share_recipients_share_id_idx" ON "chat_share_recipients" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "chat_share_recipients_recipient_id_idx" ON "chat_share_recipients" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "chat_shares_chat_id_idx" ON "chat_shares" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_shares_owner_id_idx" ON "chat_shares" USING btree ("owner_id");