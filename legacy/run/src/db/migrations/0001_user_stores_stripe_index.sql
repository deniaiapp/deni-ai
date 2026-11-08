-- Stripe webhooks look a tenant up by customer id inside the JSON document.
-- drizzle-kit cannot emit expression indexes, so this one is hand-written.
CREATE INDEX `user_stores_stripe_customer_idx` ON `user_stores` ((json_extract(`data`, '$.billing.stripeCustomerId')));
