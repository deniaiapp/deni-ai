-- Quota rows move from "tokens" (and guest "requests") to "units" at the 2026-11 reset.
-- Applying this earlier would wipe the current month's usage, so it refuses to run before then.
DO $$
BEGIN
  IF now() < timestamptz '2026-11-01 00:00:00+00' THEN
    RAISE EXCEPTION 'usage_units_reset must be applied on or after 2026-11-01 00:00 UTC';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "usage_quota";--> statement-breakpoint
UPDATE "usage_reservation" SET "unit" = 'units' WHERE "unit" IS DISTINCT FROM 'units';
