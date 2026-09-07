import { sql } from 'drizzle-orm';
import { pgTable, boolean, uuid, varchar, text, bigint, integer, jsonb, timestamp, check, index, unique, primaryKey, foreignKey } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
import type { ShippingAddress, OrderPayload, SagaStatus, SagaStep } from '@saga/shared';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  shippingAddress: jsonb('shipping_address').$type<ShippingAddress>().notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique('orders_customer_key_unique').on(t.customerId, t.idempotencyKey),
  check('order_key_valid', sql`${t.idempotencyKey} ~ '^[A-Za-z0-9:_-]{1,255}$'`),
  check('order_fingerprint_valid', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check('order_amount_valid', sql`${t.amountMinor} BETWEEN 1 AND 9999999999`),
  check('order_currency_valid', sql`${t.currency} IN ('USD', 'BDT')`),
  check('order_address_object', sql`jsonb_typeof(${t.shippingAddress}) = 'object'`),
  index('orders_created_idx').on(t.createdAt),
]);

export const orderItems = pgTable('order_items', {
  orderId: uuid('order_id').notNull().references(() => orders.id),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
}, (t) => [
  primaryKey({ columns: [t.orderId, t.productId] }),
  check('order_quantity_valid', sql`${t.quantity} BETWEEN 1 AND 10000`),
]);

export const sagaInstances = pgTable('saga_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique().references(() => orders.id),
  pendingMessageId: uuid('pending_message_id'),
  brokerAttempts: integer('broker_attempts').notNull().default(0),
  currentOperation: varchar('current_operation', { length: 50 }).notNull().default('CHARGE_PAYMENT'),
  inventoryFinalized: boolean('inventory_finalized').notNull().default(false),
  lastResult: jsonb('last_result'),
  currentStep: varchar('current_step', { length: 20 }).$type<SagaStep>().notNull().default('PAYMENT'),
  status: varchar('status', { length: 20 }).$type<SagaStatus>().notNull().default('IN_PROGRESS'),
  completedSteps: jsonb('completed_steps').$type<SagaStep[]>().notNull().default(sql`'[]'::jsonb`),
  compensatedSteps: jsonb('compensated_steps').$type<SagaStep[]>().notNull().default(sql`'[]'::jsonb`),
  payload: jsonb('payload').$type<OrderPayload>().notNull(),
  version: integer('version').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('saga_operation_valid', sql`${t.currentOperation} IN ('CHARGE_PAYMENT', 'RESERVE_INVENTORY', 'CREATE_SHIPMENT', 'FINALIZE_INVENTORY')`),
  check('saga_status_valid', sql`${t.status} IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')`),
  check('saga_step_valid', sql`${t.currentStep} IN ('PAYMENT', 'INVENTORY', 'SHIPPING')`),
  check('saga_completed_valid', sql`jsonb_typeof(${t.completedSteps}) = 'array' AND ${t.completedSteps} <@ '["PAYMENT","INVENTORY","SHIPPING"]'::jsonb`),
  check('saga_compensated_valid', sql`jsonb_typeof(${t.compensatedSteps}) = 'array' AND ${t.compensatedSteps} <@ ${t.completedSteps}`),
  check('saga_payload_object', sql`jsonb_typeof(${t.payload}) = 'object'`),
  check('saga_counters_valid', sql`${t.version} >= 0 AND ${t.attempts} >= 0`),
  check('saga_lease_valid', sql`(${t.leaseOwner} IS NULL) = (${t.leaseExpiresAt} IS NULL)`),
  index('saga_recovery_idx').on(t.status, t.nextAttemptAt),
  index('saga_stale_idx').on(t.status, t.updatedAt),
]);

export const sagaTransitions = pgTable('saga_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sagaId: uuid('saga_id').notNull().references(() => sagaInstances.id),
  sequence: integer('sequence').notNull(),
  fromStatus: varchar('from_status', { length: 20 }).$type<SagaStatus>(),
  toStatus: varchar('to_status', { length: 20 }).$type<SagaStatus>().notNull(),
  step: varchar('step', { length: 20 }).$type<SagaStep>().notNull(),
  direction: varchar('direction', { length: 20 }).notNull(),
  details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  unique('transition_sequence_unique').on(t.sagaId, t.sequence),
  check('transition_sequence_valid', sql`${t.sequence} > 0`),
  check('transition_from_valid', sql`${t.fromStatus} IS NULL OR ${t.fromStatus} IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')`),
  check('transition_to_valid', sql`${t.toStatus} IN ('IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED')`),
  check('transition_step_valid', sql`${t.step} IN ('PAYMENT', 'INVENTORY', 'SHIPPING')`),
  check('transition_direction_valid', sql`${t.direction} IN ('FORWARD', 'COMPENSATION')`),
  check('transition_details_object', sql`jsonb_typeof(${t.details}) = 'object'`),
]);

export { messageInbox, messageOutbox } from '@saga/shared/messaging';
