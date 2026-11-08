import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth-schema";

export const teamUsagePolicy = pgTable(
  "team_usage_policy",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    defaultMaxModeEnabled: boolean("default_max_mode_enabled").default(true).notNull(),
    defaultMaxModeLimitBasic: integer("default_max_mode_limit_basic"),
    defaultMaxModeLimitPremium: integer("default_max_mode_limit_premium"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: uniqueIndex("team_usage_policy_organization_idx").on(table.organizationId),
  }),
);

export const teamMemberUsagePolicy = pgTable(
  "team_member_usage_policy",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    maxModeEnabled: boolean("max_mode_enabled").default(true).notNull(),
    maxModeLimitBasic: integer("max_mode_limit_basic"),
    maxModeLimitPremium: integer("max_mode_limit_premium"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    organizationUserIdx: uniqueIndex("team_member_usage_policy_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export const teamUsageAuditLog = pgTable(
  "team_usage_audit_log",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Nullable with SET NULL so deleting an account keeps the team's audit history;
    // readers show such entries as a deleted user.
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationCreatedAtIdx: index("team_usage_audit_log_org_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const teamUsagePolicyRelations = relations(teamUsagePolicy, ({ one }) => ({
  organization: one(organization, {
    fields: [teamUsagePolicy.organizationId],
    references: [organization.id],
  }),
}));

export const teamMemberUsagePolicyRelations = relations(teamMemberUsagePolicy, ({ one }) => ({
  organization: one(organization, {
    fields: [teamMemberUsagePolicy.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [teamMemberUsagePolicy.userId],
    references: [user.id],
  }),
}));

export const teamUsageAuditLogRelations = relations(teamUsageAuditLog, ({ one }) => ({
  organization: one(organization, {
    fields: [teamUsageAuditLog.organizationId],
    references: [organization.id],
  }),
  actor: one(user, {
    fields: [teamUsageAuditLog.actorUserId],
    references: [user.id],
  }),
  targetUser: one(user, {
    fields: [teamUsageAuditLog.targetUserId],
    references: [user.id],
  }),
}));
