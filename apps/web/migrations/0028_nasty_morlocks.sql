CREATE TABLE "project_files" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"url" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "project_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "project_sources" CASCADE;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_files_project_id_idx" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_files_user_id_idx" ON "project_files" USING btree ("user_id");--> statement-breakpoint
DROP TYPE "public"."project_artifact_kind";--> statement-breakpoint
DROP TYPE "public"."project_source_kind";