-- Quota rows move from "tokens" (and guest "requests") to "units".
-- This wipes the current month's usage, so every account starts the period at zero.
DELETE FROM "usage_quota";--> statement-breakpoint
UPDATE "usage_reservation" SET "unit" = 'units' WHERE "unit" IS DISTINCT FROM 'units';
