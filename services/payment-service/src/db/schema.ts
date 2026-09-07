import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, bigint, integer, jsonb, timestamp, check, index, unique, primaryKey, foreignKey } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique(),
  sagaId: uuid('saga_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  providerTransactionId: varchar('provider_transaction_id', { length: 200 }).unique(),
  chargeResult: jsonb('charge_result'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
}, (t) => [
  unique('payments_id_order_unique').on(t.id, t.orderId),
  check('payment_amount_valid', sql`${t.amountMinor} BETWEEN 1 AND 9999999999`),
  check('payment_currency_valid', sql`${t.currency} IN ('USD', 'BDT')`),
  check('payment_status_valid', sql`${t.status} IN ('PENDING', 'CHARGED', 'REFUNDED', 'FAILED')`),
  check('payment_provider_required', sql`${t.status} NOT IN ('CHARGED', 'REFUNDED') OR ${t.providerTransactionId} IS NOT NULL`),
  check('payment_refund_time_valid', sql`(${t.status} = 'REFUNDED') = (${t.refundedAt} IS NOT NULL)`),
  index('payments_customer_idx').on(t.customerId),
  index('payments_saga_idx').on(t.sagaId),
]);

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique(),
  sagaId: uuid('saga_id').notNull(),
  paymentId: uuid('payment_id'),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  providerRefundId: varchar('provider_refund_id', { length: 200 }).unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.paymentId, t.orderId], foreignColumns: [payments.id, payments.orderId] }),
  check('refund_status_valid', sql`${t.status} IN ('PENDING', 'REFUNDED', 'NOOP')`),
  check('refund_payment_required', sql`${t.status} <> 'REFUNDED' OR ${t.paymentId} IS NOT NULL`),
  index('refunds_saga_idx').on(t.sagaId),
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
  check('receipt_operation_valid', sql`${t.operation} IN ('CHARGE_PAYMENT', 'REFUND_PAYMENT')`),
  check('receipt_result_valid', sql`(${t.status} = 'PROCESSING' AND ${t.result} IS NULL) OR (${t.status} = 'COMPLETED' AND ${t.result} IS NOT NULL AND jsonb_typeof(${t.result}) = 'object')`),
  index('receipts_order_idx').on(t.orderId),
  index('receipts_recovery_idx').on(t.status, t.updatedAt),
]);

// Durable local provider simulator, separate from application payment records.
// Production adapters must use an external provider's idempotency guarantee.
export const simulatedProviderPayments = pgTable('simulated_provider_payments', {
  orderId: uuid('order_id').primaryKey(),
  sagaId: uuid('saga_id').notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }),
  status: varchar('status', { length: 20 }).notNull(),
  transactionId: varchar('transaction_id', { length: 200 }),
}, (t) => [check('sim_payment_status', sql`${t.status} IN ('CHARGED', 'REFUNDED', 'NOOP')`)]);

export const simulatedProviderRequests = pgTable('simulated_provider_requests', {
  idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: createdAt(),
});

export { messageInbox, messageOutbox } from '@saga/shared/messaging';
