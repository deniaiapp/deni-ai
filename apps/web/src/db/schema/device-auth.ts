import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export const deviceAuthCode = pgTable(
  "device_auth_code",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userCode: text("user_code").notNull().unique(),
    deviceCode: text("device_code").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    approved: boolean("approved").notNull().default(false),
    issuedApiKeyEnc: text("issued_api_key_enc"),
    issuedApiKeyId: text("issued_api_key_id"),
    issuedAt: timestamp("issued_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("device_auth_code_user_code_idx").on(table.userCode),
    index("device_auth_code_device_code_idx").on(table.deviceCode),
  ],
);
