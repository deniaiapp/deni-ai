ALTER TABLE "device_auth_code" ADD COLUMN "issued_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "device_auth_code" ADD COLUMN "issued_api_key_id" text;--> statement-breakpoint
ALTER TABLE "device_auth_code" ADD COLUMN "issued_at" timestamp;--> statement-breakpoint
CREATE INDEX "memory_item_user_id_idx" ON "memory_item" USING btree ("user_id");