ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_id_account_id_uidx" ON "account" USING btree ("provider_id","account_id");