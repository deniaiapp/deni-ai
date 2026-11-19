CREATE TABLE "run_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"thread_id" text NOT NULL,
	"teammate_id" text,
	"path" text NOT NULL,
	"object_key" text,
	"title" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size_bytes" bigint,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_browser_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"teammate_id" text,
	"page_key" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"url" text,
	"title" text,
	"takeover_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_discord_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_discord_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"discord_username" text NOT NULL,
	"teammate_id" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"teammate_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"checkpoint" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"idempotency_key" text NOT NULL,
	"error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"transport" text DEFAULT 'streamable-http' NOT NULL,
	"auth_secret" text,
	"oauth" text,
	"catalog_id" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_mcp_explanations" (
	"user_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"locale" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_mcp_explanations_user_id_tool_call_id_locale_pk" PRIMARY KEY("user_id","tool_call_id","locale")
);
--> statement-breakpoint
CREATE TABLE "run_messages" (
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"id" text NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "run_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_messages_user_id_thread_id_id_pk" PRIMARY KEY("user_id","thread_id","id")
);
--> statement-breakpoint
CREATE TABLE "run_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_routines" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"teammate_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"locale" text,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_routines_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "run_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"model" text,
	"run_mode" text,
	"openrouter_api_key" text,
	"computer" jsonb,
	"shells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handoffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plugin_always_allow" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mcp_always_allow" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discord_thread_id" text,
	"discord_notify" boolean DEFAULT true NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_skills" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_skills_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "run_teammate_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"teammate_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_teammates" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"job" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT '#7f9bb8' NOT NULL,
	"icon" text,
	"tools" jsonb,
	"computer_access" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_teammates_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "run_thread_participants" (
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"teammate_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "run_thread_participants_user_id_thread_id_teammate_id_pk" PRIMARY KEY("user_id","thread_id","teammate_id")
);
--> statement-breakpoint
CREATE TABLE "run_threads" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"last_preview" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"section" text,
	"reactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"history_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_threads_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_job_id_run_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."run_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_browser_workspaces" ADD CONSTRAINT "run_browser_workspaces_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_discord_link_codes" ADD CONSTRAINT "run_discord_link_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_discord_links" ADD CONSTRAINT "run_discord_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_job_events" ADD CONSTRAINT "run_job_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_job_events" ADD CONSTRAINT "run_job_events_job_id_run_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."run_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_mcp_connections" ADD CONSTRAINT "run_mcp_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_mcp_explanations" ADD CONSTRAINT "run_mcp_explanations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_user_id_thread_id_run_threads_user_id_id_fk" FOREIGN KEY ("user_id","thread_id") REFERENCES "public"."run_threads"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_notifications" ADD CONSTRAINT "run_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_routines" ADD CONSTRAINT "run_routines_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_routines" ADD CONSTRAINT "run_routines_user_id_teammate_id_run_teammates_user_id_id_fk" FOREIGN KEY ("user_id","teammate_id") REFERENCES "public"."run_teammates"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_routines" ADD CONSTRAINT "run_routines_user_id_thread_id_run_threads_user_id_id_fk" FOREIGN KEY ("user_id","thread_id") REFERENCES "public"."run_threads"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_settings" ADD CONSTRAINT "run_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_teammate_memories" ADD CONSTRAINT "run_teammate_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_teammate_memories" ADD CONSTRAINT "run_teammate_memories_user_id_teammate_id_run_teammates_user_id_id_fk" FOREIGN KEY ("user_id","teammate_id") REFERENCES "public"."run_teammates"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_teammates" ADD CONSTRAINT "run_teammates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_thread_participants" ADD CONSTRAINT "run_thread_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_thread_participants" ADD CONSTRAINT "run_thread_participants_user_id_thread_id_run_threads_user_id_id_fk" FOREIGN KEY ("user_id","thread_id") REFERENCES "public"."run_threads"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_thread_participants" ADD CONSTRAINT "run_thread_participants_user_id_teammate_id_run_teammates_user_id_id_fk" FOREIGN KEY ("user_id","teammate_id") REFERENCES "public"."run_teammates"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_threads" ADD CONSTRAINT "run_threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_artifacts_user_thread_idx" ON "run_artifacts" USING btree ("user_id","thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_browser_workspaces_user_job_uidx" ON "run_browser_workspaces" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "run_browser_workspaces_user_idx" ON "run_browser_workspaces" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "run_discord_link_codes_user_idx" ON "run_discord_link_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_discord_links_discord_user_uidx" ON "run_discord_links" USING btree ("discord_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_job_events_job_sequence_uidx" ON "run_job_events" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_jobs_user_idempotency_uidx" ON "run_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "run_jobs_claim_idx" ON "run_jobs" USING btree ("run_after","created_at") WHERE "run_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "run_jobs_lease_idx" ON "run_jobs" USING btree ("lease_expires_at") WHERE "run_jobs"."status" IN ('running', 'finalizing');--> statement-breakpoint
CREATE INDEX "run_jobs_user_created_idx" ON "run_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "run_jobs_user_thread_idx" ON "run_jobs" USING btree ("user_id","thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_mcp_connections_user_name_uidx" ON "run_mcp_connections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "run_mcp_connections_user_idx" ON "run_mcp_connections" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "run_messages_thread_seq_idx" ON "run_messages" USING btree ("user_id","thread_id","seq");--> statement-breakpoint
CREATE INDEX "run_notifications_user_read_idx" ON "run_notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "run_routines_due_idx" ON "run_routines" USING btree ("next_run_at") WHERE "run_routines"."enabled" AND "run_routines"."next_run_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "run_teammate_memories_teammate_idx" ON "run_teammate_memories" USING btree ("user_id","teammate_id","created_at");--> statement-breakpoint
CREATE INDEX "run_thread_participants_teammate_idx" ON "run_thread_participants" USING btree ("user_id","teammate_id");--> statement-breakpoint
CREATE INDEX "run_threads_user_updated_idx" ON "run_threads" USING btree ("user_id","updated_at");