CREATE TABLE "cancellation_feedback" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"stripe_subscription_id" text,
	"plan_id" text,
	"reason" text,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cancellation_feedback" ADD CONSTRAINT "cancellation_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cancellation_feedback_created_at_idx" ON "cancellation_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cancellation_feedback_user_idx" ON "cancellation_feedback" USING btree ("user_id");