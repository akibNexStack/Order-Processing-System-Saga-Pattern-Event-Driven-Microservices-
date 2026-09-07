import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { commandKey, type Result, type SagaStep } from '@saga/shared';
import { commandEnvelope, enqueue, remember, messageOutbox, InvalidMessage, owner, type Envelope } from '@saga/shared/messaging';
import { sagaInstances, sagaTransitions } from '../db/schema.js';
import { OrderService } from '../orders/service.js';
import { buildCommand, forwardOperation, FORWARD_OPERATIONS, STEP_FOR_OPERATION } from './stateMachine.js';
import { nextCompensation } from './compensate.js';
type Saga = typeof sagaInstances.$inferSelect;

export class BrokerOrderService extends OrderService {
  constructor(private readonly brokerPool: pg.Pool, private readonly retryDelayMs = 1000) {
    super(brokerPool, { execute: async () => { throw new Error('HTTP transport is disabled for broker orders'); } });
  }
  protected override async onAccepted(db: NodePgDatabase, saga: Saga) { await this.dispatch(db, saga); }

  override async run(orderId: string): Promise<void> {
    // POST/resume can restart a bounded retry cycle. It never sends a second
    // command while one is outstanding, and terminal orders remain unchanged.
    await drizzle(this.brokerPool).transaction(async tx => {
      const [saga] = await tx.select().from(sagaInstances).where(eq(sagaInstances.orderId, orderId)).for('update');
      if (!saga || saga.pendingMessageId || ['FAILED', 'COMPLETED'].includes(saga.status)) return;
      await this.dispatch(tx, { ...saga, brokerAttempts: 0 });
    });
  }

  async receive(envelope: Envelope): Promise<void> {
    if (envelope.kind !== 'RESULT') throw new InvalidMessage('Orders accepts only results');
    await drizzle(this.brokerPool).transaction(async tx => {
      const result = envelope.body;
      const [saga] = await tx.select().from(sagaInstances).where(eq(sagaInstances.orderId, result.orderId)).for('update');
      const [sent] = await tx.select().from(messageOutbox).where(eq(messageOutbox.id, envelope.causationId));
      if (!saga || sent?.envelope.kind !== 'COMMAND') throw new InvalidMessage('Result has no committed command');
      const command = sent.envelope.body;
      if (result.sagaId !== saga.id || result.orderId !== command.orderId || result.operation !== command.operation
        || result.idempotencyKey !== command.idempotencyKey || result.idempotencyKey !== commandKey(saga.id, result.operation)) throw new InvalidMessage('Result correlation mismatch');
      if (!await remember(tx, envelope)) return;
      // Delayed results from prior attempts cannot overwrite newer progress.
      if (saga.pendingMessageId !== envelope.causationId || ['FAILED', 'COMPLETED'].includes(saga.status)) return;
      const expected = this.next(saga);
      if (!expected || expected.operation !== result.operation) throw new InvalidMessage('Result does not match saga progress');
      const direction = saga.status === 'COMPENSATING' ? 'COMPENSATION' : 'FORWARD';
      const common = { pendingMessageId: null, lastResult: result, leaseOwner: null, leaseExpiresAt: null };
      let updated: Saga;
      let retry = false;
      if (saga.status === 'COMPENSATING') {
        if (result.outcome === 'SUCCEEDED') {
          updated = await this.save(tx, saga, { ...common, brokerAttempts: 0, compensatedSteps: [...saga.compensatedSteps, expected.step] },
            'COMPENSATION_SUCCEEDED', result, direction, expected.step);
        } else {
          updated = await this.save(tx, saga, common, 'COMPENSATION_RETRY_REQUIRED', result, direction, expected.step); retry = true;
        }
      } else if (result.outcome === 'UNKNOWN') {
        updated = await this.save(tx, saga, common, 'RETRY_REQUIRED', result); retry = true;
      } else if (result.outcome === 'FAILED') {
        const rejected = (result.operation === 'CHARGE_PAYMENT' && result.error.code === 'PAYMENT_DECLINED')
          || (result.operation === 'RESERVE_INVENTORY' && result.error.code === 'INSUFFICIENT_STOCK')
          || (result.operation === 'CREATE_SHIPMENT' && result.error.code === 'SHIPPING_REJECTED');
        updated = await this.save(tx, saga, { ...common,
          status: rejected ? (saga.completedSteps.length ? 'COMPENSATING' : 'FAILED') : 'IN_PROGRESS',
          brokerAttempts: rejected ? 0 : saga.brokerAttempts }, 'STEP_REJECTED', result);
        retry = !rejected;
      } else if (result.operation === 'FINALIZE_INVENTORY') {
        await this.save(tx, saga, { ...common, status: 'COMPLETED', inventoryFinalized: true, brokerAttempts: 0 }, 'ORDER_COMPLETED', result);
        return;
      } else {
        const operation = forwardOperation(result.operation);
        const next = FORWARD_OPERATIONS[FORWARD_OPERATIONS.indexOf(operation) + 1];
        updated = await this.save(tx, saga, { ...common, brokerAttempts: 0, completedSteps: [...saga.completedSteps, expected.step],
          currentOperation: next, currentStep: STEP_FOR_OPERATION[next] }, 'STEP_SUCCEEDED', result);
      }
      if (updated.status === 'FAILED') return;
      if (retry && updated.brokerAttempts >= 3) {
        // Keep unfinished business visible; dead-letter the triggering event for
        // inspection. A manual resume starts another bounded cycle with stable keys.
        await enqueue(tx, 'dead.orders', envelope);
        return;
      }
      await this.dispatch(tx, updated, retry ? new Date(Date.now() + this.retryDelayMs * updated.brokerAttempts) : new Date());
    });
  }

  private next(saga: Saga) {
    if (saga.status === 'COMPENSATING') return nextCompensation(saga);
    const operation = forwardOperation(saga.currentOperation);
    const expected = ['PAYMENT', 'INVENTORY', 'SHIPPING'].slice(0, FORWARD_OPERATIONS.indexOf(operation));
    if (saga.status !== 'IN_PROGRESS' || saga.inventoryFinalized || saga.compensatedSteps.length
      || saga.currentStep !== STEP_FOR_OPERATION[operation] || JSON.stringify(saga.completedSteps) !== JSON.stringify(expected)) throw new Error('Inconsistent forward progress');
    return { operation, step: STEP_FOR_OPERATION[operation] };
  }
  private async dispatch(db: NodePgDatabase, saga: Saga, availableAt = new Date()) {
    const next = this.next(saga);
    if (!next) {
      await this.save(db, saga, { status: 'FAILED', pendingMessageId: null }, 'COMPENSATION_COMPLETED', undefined, 'COMPENSATION');
      return;
    }
    const envelope = commandEnvelope(buildCommand(next.operation, saga.orderId, saga.id, saga.payload));
    await this.save(db, saga, { pendingMessageId: envelope.messageId, attempts: saga.attempts + 1,
      brokerAttempts: saga.brokerAttempts + 1, nextAttemptAt: availableAt },
      saga.status === 'COMPENSATING' ? 'COMPENSATION_DISPATCHED' : 'COMMAND_DISPATCHED', undefined,
      saga.status === 'COMPENSATING' ? 'COMPENSATION' : 'FORWARD', next.step);
    await enqueue(db, owner(next.operation), envelope, availableAt);
  }
  private async save(db: NodePgDatabase, saga: Saga, patch: Partial<typeof sagaInstances.$inferInsert>, event: string,
    result?: Result, direction = 'FORWARD', step: SagaStep = saga.currentStep): Promise<Saga> {
    const [updated] = await db.update(sagaInstances).set({ ...patch, version: saga.version + 1, updatedAt: new Date() })
      .where(eq(sagaInstances.id, saga.id)).returning();
    await db.insert(sagaTransitions).values({ sagaId: saga.id, sequence: updated.version, fromStatus: saga.status,
      toStatus: updated.status, step, direction, details: { event, ...(result ? { operation: result.operation, result } : {}) } });
    return updated;
  }
}
