import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull().default(""),
    color: text("color").notNull().default("amber"),
    defaultModel: text("default_model"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("projects_user_id_idx").on(table.userId),
    index("projects_user_archived_idx").on(table.userId, table.archivedAt),
    index("projects_organization_id_idx").on(table.organizationId),
  ],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull().default(0),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_files_project_id_idx").on(table.projectId),
    index("project_files_user_id_idx").on(table.userId),
  ],
);
