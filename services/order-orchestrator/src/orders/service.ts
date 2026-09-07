import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { CreateOrderRequestSchema, orderFingerprint, ResultSchema, type CreateOrderRequest, type Result, type SagaStatus } from '@saga/shared';
import { orders, orderItems, sagaInstances, sagaTransitions } from '../db/schema.js';
import { buildCommand, FORWARD_OPERATIONS, forwardOperation, STEP_FOR_OPERATION } from '../saga/stateMachine.js';
import type { CommandTransport } from '../saga/httpTransport.js';

type Saga = typeof sagaInstances.$inferSelect;
export class OrderConflict extends Error {}
export class OrderService {
  constructor(private readonly pool: pg.Pool, private readonly transport: CommandTransport) {}

  async accept(input: CreateOrderRequest): Promise<{ orderId: string; created: boolean }> {
    const parsed = CreateOrderRequestSchema.parse(input);
    const payload = { ...parsed.payload, customerId: parsed.payload.customerId.toLowerCase(),
      items: parsed.payload.items.map(item => ({ ...item, productId: item.productId.toLowerCase() })).sort((a, b) => a.productId.localeCompare(b.productId)) };
    const fingerprint = orderFingerprint(payload);
    return drizzle(this.pool).transaction(async tx => {
      const [inserted] = await tx.insert(orders).values({ customerId: payload.customerId, idempotencyKey: parsed.idempotencyKey, fingerprint,
        amountMinor: payload.amountMinor, currency: payload.currency, shippingAddress: payload.shippingAddress })
        .onConflictDoNothing({ target: [orders.customerId, orders.idempotencyKey] }).returning();
      if (!inserted) {
        const [existing] = await tx.select().from(orders).where(and(eq(orders.customerId, payload.customerId), eq(orders.idempotencyKey, parsed.idempotencyKey)));
        if (existing.fingerprint !== fingerprint) throw new OrderConflict('This customer key already belongs to a different order payload');
        return { orderId: existing.id, created: false };
      }
      await tx.insert(orderItems).values(payload.items.map(item => ({ orderId: inserted.id, ...item })));
      const [saga] = await tx.insert(sagaInstances).values({ orderId: inserted.id, payload, version: 1 }).returning();
      await tx.insert(sagaTransitions).values({ sagaId: saga.id, sequence: 1, toStatus: 'IN_PROGRESS', step: 'PAYMENT', direction: 'FORWARD', details: { event: 'ORDER_ACCEPTED' } });
      return { orderId: inserted.id, created: true };
    });
  }

  async run(orderId: string): Promise<void> {
    const client = await this.pool.connect();
    const lock = `order-orchestrator:${orderId}`;
    let locked = false, discard = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])).rows[0].locked;
      if (!locked) return;
      const db = drizzle(client);
      let [saga] = await db.select().from(sagaInstances).where(eq(sagaInstances.orderId, orderId));
      if (!saga || saga.status !== 'IN_PROGRESS') return;
      // A request does at most one attempt per remaining operation. Retry unknown
      // outcomes explicitly; no fire-and-forget tasks or background loop in Part 6.
      for (let remaining = 0; remaining < FORWARD_OPERATIONS.length; remaining++) {
        const operation = forwardOperation(saga.currentOperation);
        const expectedSteps = ['PAYMENT', 'INVENTORY', 'SHIPPING'].slice(0, FORWARD_OPERATIONS.indexOf(operation));
        if (JSON.stringify(saga.completedSteps) !== JSON.stringify(expectedSteps) || saga.currentStep !== STEP_FOR_OPERATION[operation] || saga.inventoryFinalized) {
          throw new Error('Inconsistent persisted saga progress; reconcile before continuing');
        }
        const command = buildCommand(operation, orderId, saga.id, saga.payload);
        saga = await this.transition(db, saga, { attempts: saga.attempts + 1, leaseOwner: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) }, { event: 'COMMAND_DISPATCHED', operation });
        let result: Result;
        try {
          result = ResultSchema.parse(await this.transport.execute(command));
          if (result.operation !== operation || result.orderId !== orderId || result.sagaId !== saga.id || result.idempotencyKey !== command.idempotencyKey) throw new Error('Mismatched result');
        } catch {
          const { payload: _, ...metadata } = command;
          result = ResultSchema.parse({ ...metadata, outcome: 'UNKNOWN', error: { code: 'PROVIDER_UNAVAILABLE', message: 'Command outcome could not be confirmed', retryable: true } });
        }
        const common = { lastResult: result, leaseOwner: null, leaseExpiresAt: null };
        if (result.outcome === 'UNKNOWN') {
          await this.transition(db, saga, { ...common, nextAttemptAt: new Date(Date.now() + 1000) }, { event: 'RETRY_REQUIRED', operation, result });
          return;
        }
        if (result.outcome === 'FAILED') {
          // Finalization is a completion boundary: never compensate on an uncertain
          // completion write. Confirmed rejection here needs inspection/reconciliation.
          const expectedRejection = (operation === 'CHARGE_PAYMENT' && result.error.code === 'PAYMENT_DECLINED')
            || (operation === 'RESERVE_INVENTORY' && result.error.code === 'INSUFFICIENT_STOCK')
            || (operation === 'CREATE_SHIPMENT' && result.error.code === 'SHIPPING_REJECTED');
          const status: SagaStatus = !expectedRejection ? 'IN_PROGRESS'
            : saga.completedSteps.length ? 'COMPENSATING' : 'FAILED';
          await this.transition(db, saga, { ...common, status }, { event: operation === 'FINALIZE_INVENTORY' ? 'FINALIZATION_REJECTED' : 'STEP_REJECTED', operation, result });
          return;
        }
        if (operation === 'FINALIZE_INVENTORY') {
          await this.transition(db, saga, { ...common, status: 'COMPLETED', inventoryFinalized: true }, { event: 'ORDER_COMPLETED', operation, result });
          return;
        }
        const nextOperation = FORWARD_OPERATIONS[FORWARD_OPERATIONS.indexOf(operation) + 1];
        saga = await this.transition(db, saga, { ...common, completedSteps: [...saga.completedSteps, STEP_FOR_OPERATION[operation]],
          currentOperation: nextOperation, currentStep: STEP_FOR_OPERATION[nextOperation], nextAttemptAt: new Date() }, { event: 'STEP_SUCCEEDED', operation, result });
      }
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]); }
        catch { discard = true; }
      }
      client.release(discard);
    }
  }

  private async transition(db: NodePgDatabase, saga: Saga, patch: Partial<typeof sagaInstances.$inferInsert>, details: object): Promise<Saga> {
    return db.transaction(async tx => {
      const [updated] = await tx.update(sagaInstances).set({ ...patch, version: saga.version + 1, updatedAt: new Date() })
        .where(and(eq(sagaInstances.id, saga.id), eq(sagaInstances.version, saga.version))).returning();
      if (!updated) throw new Error('Saga changed concurrently; retry from persisted state');
      await tx.insert(sagaTransitions).values({ sagaId: saga.id, sequence: updated.version, fromStatus: saga.status,
        toStatus: updated.status, step: saga.currentStep, direction: 'FORWARD', details });
      return updated;
    });
  }

  async status(orderId: string) {
    return drizzle(this.pool).transaction(async tx => {
      const [row] = await tx.select({ order: orders, saga: sagaInstances }).from(orders)
        .innerJoin(sagaInstances, eq(orders.id, sagaInstances.orderId)).where(eq(orders.id, orderId));
      if (!row) return null;
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.productId));
      const transitions = await tx.select().from(sagaTransitions).where(eq(sagaTransitions.sagaId, row.saga.id)).orderBy(asc(sagaTransitions.sequence));
      return { ...row, items, transitions, requiresCompensation: row.saga.status === 'COMPENSATING' };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }
}
