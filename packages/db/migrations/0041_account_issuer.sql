ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = CASE "provider_id"
	WHEN 'google' THEN 'https://accounts.google.com'
	WHEN 'github' THEN 'local:oauth:github'
	WHEN 'credential' THEN 'local:credential'
	ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
DELETE FROM "account" AS a
USING "account" AS b
WHERE a."issuer" = b."issuer"
	AND a."account_id" = b."account_id"
	AND a."id" <> b."id"
	AND (
		a."updated_at" < b."updated_at"
		OR (a."updated_at" = b."updated_at" AND a."id" < b."id")
	);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");