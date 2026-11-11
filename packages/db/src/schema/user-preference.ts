import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Per-account settings that follow the user across browsers and devices.
 * `preferred_model`: the model last picked in the composer, the default for new
 * chats (the client also caches it in localStorage for an instant first paint).
 */
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  preferredModel: text("preferred_model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
