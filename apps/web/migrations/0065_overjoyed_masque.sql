ALTER TABLE "team_usage_audit_log" DROP CONSTRAINT "team_usage_audit_log_actor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "team_usage_audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing" ADD COLUMN "card_removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "team_usage_audit_log" ADD CONSTRAINT "team_usage_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;