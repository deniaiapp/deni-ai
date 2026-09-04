CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" text PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_stores_stripe_customer_idx"
  ON "user_stores" ((data->'billing'->>'stripeCustomerId'));
