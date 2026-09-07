import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, bigint, integer, jsonb, timestamp, check, index, unique, primaryKey, foreignKey } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  availableStock: integer('available_stock').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('stock_nonnegative', sql`${t.availableStock} >= 0`),
  check('product_text_valid', sql`length(trim(${t.sku})) > 0 AND length(trim(${t.name})) > 0`),
]);

export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique(),
  sagaId: uuid('saga_id').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('reservation_status_valid', sql`${t.status} IN ('PENDING', 'RESERVED', 'RELEASED', 'FINALIZED', 'FAILED')`),
  check('reservation_expiry_valid', sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.createdAt}`),
  index('reservations_saga_idx').on(t.sagaId),
  index('reservations_expiry_idx').on(t.status, t.expiresAt),
]);

export const reservationItems = pgTable('reservation_items', {
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
}, (t) => [
  primaryKey({ columns: [t.reservationId, t.productId] }),
  check('reservation_quantity_valid', sql`${t.quantity} BETWEEN 1 AND 10000`),
  index('reservation_items_product_idx').on(t.productId),
]);

// Insert-first deduplication ledger. Side effects and final results must be committed
// atomically where possible; external provider calls still require reconciliation.
export const commandReceipts = pgTable('command_receipts', {
  idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
  orderId: uuid('order_id').notNull(),
  sagaId: uuid('saga_id').notNull(),
  operation: varchar('operation', { length: 50 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PROCESSING'),
  result: jsonb('result'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('receipt_key_valid', sql`${t.idempotencyKey} ~ '^[A-Za-z0-9:_-]{1,255}$'`),
  check('receipt_fingerprint_valid', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check('receipt_status_valid', sql`${t.status} IN ('PROCESSING', 'COMPLETED')`),
  check('receipt_operation_valid', sql`${t.operation} IN ('RESERVE_INVENTORY', 'RELEASE_INVENTORY')`),
  check('receipt_result_valid', sql`(${t.status} = 'PROCESSING' AND ${t.result} IS NULL) OR (${t.status} = 'COMPLETED' AND ${t.result} IS NOT NULL AND jsonb_typeof(${t.result}) = 'object')`),
  index('receipts_order_idx').on(t.orderId),
  index('receipts_recovery_idx').on(t.status, t.updatedAt),
]);
