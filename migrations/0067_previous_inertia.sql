CREATE TABLE "account_export" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text,
	"storage_key" text,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing" DROP CONSTRAINT "billing_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "billing" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_export" ADD CONSTRAINT "account_export_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_export_user_created_idx" ON "account_export" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_export_status_expires_idx" ON "account_export" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "account_export_status_created_idx" ON "account_export" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "attachment_user_id_idx" ON "attachment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachment_chat_id_idx" ON "attachment" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "attachment_status_created_idx" ON "attachment" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_storage_key_idx" ON "attachment" USING btree ("storage_key");--> statement-breakpoint
ALTER TABLE "billing" ADD CONSTRAINT "billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_organization_idx" ON "billing" USING btree ("organization_id","created_at","id") WHERE organization_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "billing" ADD CONSTRAINT "billing_personal_user_check" CHECK ("billing"."organization_id" IS NOT NULL OR "billing"."user_id" IS NOT NULL);