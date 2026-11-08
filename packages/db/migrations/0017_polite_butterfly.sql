CREATE TABLE "device_auth_code" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_code" text NOT NULL,
	"device_code" text NOT NULL,
	"user_id" text,
	"approved" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_code_user_code_unique" UNIQUE("user_code"),
	CONSTRAINT "device_auth_code_device_code_unique" UNIQUE("device_code")
);
--> statement-breakpoint
ALTER TABLE "device_auth_code" ADD CONSTRAINT "device_auth_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_auth_code_user_code_idx" ON "device_auth_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "device_auth_code_device_code_idx" ON "device_auth_code" USING btree ("device_code");