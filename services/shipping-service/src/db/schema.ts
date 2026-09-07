import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, bigint, integer, jsonb, timestamp, check, index, unique, primaryKey, foreignKey } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
import type { ShippingAddress, OrderItems } from '@saga/shared';

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique(),
  sagaId: uuid('saga_id').notNull(),
  shippingAddress: jsonb('shipping_address').$type<ShippingAddress>().notNull(),
  items: jsonb('items').$type<OrderItems>().notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  providerShipmentId: varchar('provider_shipment_id', { length: 200 }).unique(),
  createResult: jsonb('create_result'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('shipments_id_order_unique').on(t.id, t.orderId),
  check('shipment_status_valid', sql`${t.status} IN ('PENDING', 'CREATED', 'CANCELLED', 'FAILED')`),
  check('shipment_address_object', sql`jsonb_typeof(${t.shippingAddress}) = 'object'`),
  check('shipment_items_valid', sql`CASE WHEN jsonb_typeof(${t.items}) = 'array' THEN jsonb_array_length(${t.items}) BETWEEN 1 AND 100 ELSE false END`),
  check('shipment_provider_required', sql`${t.status} NOT IN ('CREATED', 'CANCELLED') OR ${t.providerShipmentId} IS NOT NULL`),
  check('shipment_cancel_time_valid', sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} IS NOT NULL)`),
  index('shipments_saga_idx').on(t.sagaId),
]);

export const shipmentCancellations = pgTable('shipment_cancellations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique(),
  sagaId: uuid('saga_id').notNull(),
  shipmentId: uuid('shipment_id'),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.shipmentId, t.orderId], foreignColumns: [shipments.id, shipments.orderId] }),
  check('cancellation_status_valid', sql`${t.status} IN ('PENDING', 'CANCELLED', 'NOOP')`),
  check('cancellation_shipment_required', sql`${t.status} <> 'CANCELLED' OR ${t.shipmentId} IS NOT NULL`),
  index('cancellations_saga_idx').on(t.sagaId),
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
  check('receipt_operation_valid', sql`${t.operation} IN ('CREATE_SHIPMENT', 'CANCEL_SHIPMENT')`),
  check('receipt_result_valid', sql`(${t.status} = 'PROCESSING' AND ${t.result} IS NULL) OR (${t.status} = 'COMPLETED' AND ${t.result} IS NOT NULL AND jsonb_typeof(${t.result}) = 'object')`),
  index('receipts_order_idx').on(t.orderId),
  index('receipts_recovery_idx').on(t.status, t.updatedAt),
]);

// Durable local provider simulator, separate from application shipment records.
// Production adapters must use an external provider's idempotency guarantee.
export const simulatedProviderShipments = pgTable('simulated_provider_shipments', {
  orderId: uuid('order_id').primaryKey(),
  sagaId: uuid('saga_id').notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }),
  status: varchar('status', { length: 20 }).notNull(),
  shipmentId: varchar('shipment_id', { length: 200 }),
}, (t) => [check('sim_shipment_status', sql`${t.status} IN ('CREATED', 'CANCELLED', 'NOOP')`)]);

export const simulatedProviderRequests = pgTable('simulated_provider_requests', {
  idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: createdAt(),
});
