import { sql } from 'drizzle-orm';
import { pgTable, uuid, jsonb, timestamp, varchar, index, check } from 'drizzle-orm/pg-core';
import type { Envelope } from './contracts.js';

export const messageOutbox = pgTable('message_outbox', {
  id: uuid('id').primaryKey(),
  route: varchar('route', { length: 100 }).notNull(),
  envelope: jsonb('envelope').$type<Envelope>().notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('outbox_pending_idx').on(t.availableAt).where(sql`${t.publishedAt} IS NULL`),
  check('outbox_envelope_object', sql`jsonb_typeof(${t.envelope}) = 'object'`)]);
export const messageInbox = pgTable('message_inbox', {
  id: uuid('id').primaryKey(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('inbox_fingerprint_valid', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`)]);
