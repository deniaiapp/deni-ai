WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "user_id", "job_id"
			ORDER BY "sequence", "created_at", "id"
		)::integer AS "next_sequence"
	FROM "job_events"
)
UPDATE "job_events" AS events
SET "sequence" = ranked."next_sequence"
FROM ranked
WHERE events."id" = ranked."id"
	AND events."sequence" <> ranked."next_sequence";
--> statement-breakpoint
CREATE UNIQUE INDEX "job_events_user_job_sequence_uidx" ON "job_events" USING btree ("user_id","job_id","sequence");
