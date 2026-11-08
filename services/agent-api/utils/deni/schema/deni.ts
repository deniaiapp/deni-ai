/**
 * Deni AI tables that Flixa reads or writes, declared with only the columns
 * Flixa uses. Deni AI owns and migrates them (deni-ai/src/db/schema/); this file
 * is never passed to drizzle-kit, so keep it in sync with Deni AI's schema by hand.
 */

import { pgTable, text } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
});

export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
});
