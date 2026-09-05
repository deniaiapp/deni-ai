CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"checkpoint" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"idempotency_key" text NOT NULL,
	"error" text,
	"locked_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_notifications" (
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
CREATE TABLE "browser_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"bot_id" text,
	"page_key" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"url" text,
	"title" text,
	"takeover_job_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"thread_id" text NOT NULL,
	"bot_id" text,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"transport" text DEFAULT 'streamable-http' NOT NULL,
	"auth_secret" text,
	"headers" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_jobs_user_status_idx" ON "agent_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "agent_jobs_user_updated_idx" ON "agent_jobs" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_jobs_user_idempotency_uidx" ON "agent_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "app_notifications_user_read_idx" ON "app_notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_workspaces_user_job_uidx" ON "browser_workspaces" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "browser_workspaces_user_idx" ON "browser_workspaces" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "job_artifacts_user_thread_idx" ON "job_artifacts" USING btree ("user_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "job_events_user_job_idx" ON "job_events" USING btree ("user_id","job_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_user_name_uidx" ON "mcp_connections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "mcp_connections_user_idx" ON "mcp_connections" USING btree ("user_id","updated_at");