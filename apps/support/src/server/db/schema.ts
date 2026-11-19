/**
 * Tables the help center owns, in the `support` Postgres schema of the Deni AI
 * database. Migrations: `pnpm run db:generate` / `pnpm run db:migrate`
 * (drizzle.config.ts). Deni AI's drizzle-kit only manages `public`, so it never
 * touches these.
 */

import { index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SentRequest } from '@/lib/support-protocol';

export const support = pgSchema('support');

export type ConversationStatus = 'open' | 'closed';

/** One support widget conversation: AI chat, messages sent to the team, and replies. */
export const conversation = support.table(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lang: text('lang').notNull(),
    /** Page the widget was first used on. */
    pagePath: text('page_path'),
    /** Latest reply address the visitor gave with a contact or feedback message. */
    email: text('email'),
    /** `closed` hides a handled request from the admin inbox until the visitor writes again. */
    status: text('status').$type<ConversationStatus>().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Last contact or feedback message; set means the conversation is in the inbox. */
    lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
    lastStaffReplyAt: timestamp('last_staff_reply_at', { withTimezone: true }),
  },
  (table) => [index('conversation_last_request_at_idx').on(table.lastRequestAt.desc())],
);

export type MessageRole = 'user' | 'assistant' | 'staff';

export const message = support.table(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: text('role').$type<MessageRole>().notNull(),
    content: text('content').notNull(),
    /** Set on a user message that was sent to the team as contact or feedback. */
    request: jsonb('request').$type<SentRequest>(),
    /** Help articles an assistant answer cited. */
    sources: jsonb('sources').$type<{ title: string; url: string }[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('message_conversation_created_idx').on(table.conversationId, table.createdAt)],
);
