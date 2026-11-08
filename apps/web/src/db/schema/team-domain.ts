import { relations, sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth-schema";

/**
 * Email domains a team has claimed. A domain counts only once a DNS TXT record
 * proves the team controls it, and only one team can hold it verified.
 */
export const teamDomain = pgTable(
  "team_domain",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    organizationDomainIdx: uniqueIndex("team_domain_org_domain_idx").on(
      table.organizationId,
      table.domain,
    ),
    verifiedDomainIdx: uniqueIndex("team_domain_verified_domain_idx")
      .on(table.domain)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
  }),
);

/** How users with a verified team domain join: auto, request (admin approval) or off. */
export const teamDomainPolicy = pgTable(
  "team_domain_policy",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    joinMode: text("join_mode").default("request").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: uniqueIndex("team_domain_policy_organization_idx").on(table.organizationId),
  }),
);

/** A domain user's request to join, decided by a team owner or admin. */
export const teamJoinRequest = pgTable(
  "team_join_request",
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
    // "pending" | "approved" | "declined"
    status: text("status").default("pending").notNull(),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationUserIdx: uniqueIndex("team_join_request_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    userIdx: index("team_join_request_user_idx").on(table.userId),
  }),
);

export const teamDomainRelations = relations(teamDomain, ({ one }) => ({
  organization: one(organization, {
    fields: [teamDomain.organizationId],
    references: [organization.id],
  }),
}));

export const teamJoinRequestRelations = relations(teamJoinRequest, ({ one }) => ({
  organization: one(organization, {
    fields: [teamJoinRequest.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [teamJoinRequest.userId],
    references: [user.id],
  }),
}));
