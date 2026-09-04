CREATE TABLE IF NOT EXISTS "user_stores" (
  "user_id" text PRIMARY KEY NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "thread_messages" (
  "user_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "messages" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "thread_messages_user_id_thread_id_pk" PRIMARY KEY("user_id", "thread_id")
);
