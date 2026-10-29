-- The drizzle migrator creates the schema for its journal before running this.
CREATE SCHEMA IF NOT EXISTS "flixa";
--> statement-breakpoint
-- Earlier releases created these tables in public at runtime (CREATE TABLE IF NOT
-- EXISTS). Move them, rename their constraints and indexes to the names drizzle-kit
-- expects, and drop rows of deleted accounts, which the new user FKs would reject.
DO $$
BEGIN
  IF to_regclass('public.flixa_ban') IS NOT NULL AND to_regclass('flixa.ban') IS NULL THEN
    ALTER TABLE public.flixa_ban SET SCHEMA flixa;
    ALTER TABLE flixa.flixa_ban RENAME TO ban;
    ALTER TABLE flixa.ban RENAME CONSTRAINT flixa_ban_pkey TO ban_pkey;
    DROP INDEX IF EXISTS flixa.flixa_ban_banned_at_idx;
    DELETE FROM flixa.ban b WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = b.user_id);
  END IF;

  IF to_regclass('public.flixa_silent_ban_rule') IS NOT NULL AND to_regclass('flixa.silent_ban_rule') IS NULL THEN
    ALTER TABLE public.flixa_silent_ban_rule SET SCHEMA flixa;
    ALTER TABLE flixa.flixa_silent_ban_rule RENAME TO silent_ban_rule;
    ALTER TABLE flixa.silent_ban_rule RENAME CONSTRAINT flixa_silent_ban_rule_pkey TO silent_ban_rule_pkey;
    DROP INDEX IF EXISTS flixa.flixa_silent_ban_rule_enabled_idx;
  END IF;

  IF to_regclass('public.flixa_silent_ban_hit') IS NOT NULL AND to_regclass('flixa.silent_ban_hit') IS NULL THEN
    ALTER TABLE public.flixa_silent_ban_hit SET SCHEMA flixa;
    ALTER TABLE flixa.flixa_silent_ban_hit RENAME TO silent_ban_hit;
    ALTER TABLE flixa.silent_ban_hit RENAME CONSTRAINT flixa_silent_ban_hit_pkey TO silent_ban_hit_user_id_rule_id_pk;
    ALTER TABLE flixa.silent_ban_hit DROP CONSTRAINT flixa_silent_ban_hit_rule_id_fkey;
    DROP INDEX IF EXISTS flixa.flixa_silent_ban_hit_rule_idx;
    DELETE FROM flixa.silent_ban_hit h WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = h.user_id);
  END IF;

  IF to_regclass('public.flixa_usage_reservation') IS NOT NULL AND to_regclass('flixa.usage_reservation') IS NULL THEN
    ALTER TABLE public.flixa_usage_reservation SET SCHEMA flixa;
    ALTER TABLE flixa.flixa_usage_reservation RENAME TO usage_reservation;
    ALTER TABLE flixa.usage_reservation RENAME CONSTRAINT flixa_usage_reservation_pkey TO usage_reservation_pkey;
    ALTER TABLE flixa.usage_reservation RENAME CONSTRAINT flixa_usage_reservation_amount_check TO usage_reservation_amount_check;
    DELETE FROM flixa.usage_reservation r WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = r.user_id);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flixa"."ban" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"client_headers" jsonb,
	"banned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flixa"."silent_ban_hit" (
	"user_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"first_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "silent_ban_hit_user_id_rule_id_pk" PRIMARY KEY("user_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flixa"."silent_ban_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"hits_before_ban" integer DEFAULT 3 NOT NULL,
	"reason" text DEFAULT 'silent_ban_rule' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flixa"."usage_reservation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"plan_tier" text NOT NULL,
	"period_start" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_reservation_amount_check" CHECK ("flixa"."usage_reservation"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "flixa"."ban" ADD CONSTRAINT "ban_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flixa"."silent_ban_hit" ADD CONSTRAINT "silent_ban_hit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flixa"."silent_ban_hit" ADD CONSTRAINT "silent_ban_hit_rule_id_silent_ban_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "flixa"."silent_ban_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flixa"."usage_reservation" ADD CONSTRAINT "usage_reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ban_banned_at_idx" ON "flixa"."ban" USING btree ("banned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "silent_ban_hit_rule_idx" ON "flixa"."silent_ban_hit" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "silent_ban_rule_enabled_idx" ON "flixa"."silent_ban_rule" USING btree ("enabled") WHERE "flixa"."silent_ban_rule"."enabled" = TRUE;
