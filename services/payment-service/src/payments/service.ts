import { eq, or } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { ChargePaymentCommandSchema, RefundPaymentCommandSchema, ResultSchema, commandFingerprint, commandKey, type PaymentProvider, type Result } from '@saga/shared';
import { commandReceipts, payments, refunds } from '../db/schema.js';
import { failure, resultFor, success, unknown, type PaymentCommand } from './results.js';

type Payment = typeof payments.$inferSelect;
export class PaymentService {
  constructor(private readonly pool: pg.Pool, private readonly provider: PaymentProvider, private readonly providerTimeoutMs = 5000) {}

  async execute(input: PaymentCommand): Promise<Result> {
    const parsed = input.operation === 'CHARGE_PAYMENT' ? ChargePaymentCommandSchema.parse(input) : RefundPaymentCommandSchema.parse(input);
    const command: PaymentCommand = { ...parsed, orderId: parsed.orderId.toLowerCase(), sagaId: parsed.sagaId.toLowerCase(),
      ...(parsed.operation === 'CHARGE_PAYMENT' ? { payload: { ...parsed.payload, customerId: parsed.payload.customerId.toLowerCase() } } : {}),
    } as PaymentCommand;
    const client = await this.pool.connect();
    const lock = `payment-service:${command.orderId}`;
    let locked = false;
    let discard = false;
    try {
      // Session lock spans short transactions and the provider call. No transaction
      // remains open while waiting for the provider. Competing callers retry safely.
      locked = (await client.query('select pg_try_advisory_lock(hashtextextended($1,0)) as locked', [lock])).rows[0].locked;
      if (!locked) return unknown(command, 'Another operation is processing this order; retry the same key');
      const db = drizzle(client);
      const fingerprint = commandFingerprint(command);
      const receipt = await db.transaction(async (tx) => {
        await tx.insert(commandReceipts).values({ idempotencyKey: command.idempotencyKey, orderId: command.orderId,
          sagaId: command.sagaId, operation: command.operation, fingerprint }).onConflictDoNothing();
        const [row] = await tx.select().from(commandReceipts).where(eq(commandReceipts.idempotencyKey, command.idempotencyKey));
        return row;
      });
      if (receipt.fingerprint !== fingerprint) return failure(command, 'IDEMPOTENCY_CONFLICT', 'This key was used with a different command');
      if (receipt.status === 'COMPLETED') return ResultSchema.parse(receipt.result);

      const [payment] = await db.select().from(payments).where(eq(payments.orderId, command.orderId));
      const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, command.orderId));
      let result: Result;
      if ((payment && payment.sagaId !== command.sagaId) || (refund && refund.sagaId !== command.sagaId)) {
        result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order belongs to another saga');
      } else if (command.operation === 'CHARGE_PAYMENT') {
        if (payment && (payment.customerId !== command.payload.customerId || payment.amountMinor !== command.payload.amountMinor || payment.currency !== command.payload.currency)) {
          result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order payment details cannot change');
        } else if (refund || payment?.status === 'REFUNDED') {
          result = failure(command, 'ALREADY_COMPENSATED', 'Payment has a compensation request');
        } else {
          const existing = payment ?? (await db.insert(payments).values({ orderId: command.orderId, sagaId: command.sagaId, ...command.payload }).returning())[0];
          result = resultFor(command, await this.resolveCharge(db, existing));
        }
      } else {
        await db.insert(refunds).values({ orderId: command.orderId, sagaId: command.sagaId, paymentId: payment?.id }).onConflictDoNothing();
        if (refund?.status === 'REFUNDED' || refund?.status === 'NOOP') {
          result = success(command, { status: refund.status });
        } else {
          let chargeResult: Result | undefined;
          if (payment?.status === 'PENDING') chargeResult = await this.resolveCharge(db, payment);
          if (chargeResult?.outcome === 'UNKNOWN') {
            result = unknown(command, 'Original charge is unresolved; retry refund with the same key');
          } else if (!payment || payment.status === 'FAILED' || chargeResult?.outcome === 'FAILED') {
            result = success(command, { status: 'NOOP' });
          } else {
            result = resultFor(command, await this.callProvider({ ...command, idempotencyKey: commandKey(command.sagaId, command.operation) }));
          }
        }
      }
      if (result.outcome === 'UNKNOWN') return result;
      // A failed refund remains pending and retryable with its original key. It must
      // never be mistaken for completed compensation by an orchestrator.
      if (command.operation === 'REFUND_PAYMENT' && result.outcome === 'FAILED') return result;
      await db.transaction(async (tx) => {
        if (command.operation === 'REFUND_PAYMENT' && result.outcome === 'SUCCEEDED' && result.operation === 'REFUND_PAYMENT') {
          await tx.update(refunds).set({ status: result.data.status, updatedAt: new Date() }).where(eq(refunds.orderId, command.orderId));
          if (payment) {
            // Re-read because resolving a pending charge may have set CHARGED/FAILED.
            const [current] = await tx.select().from(payments).where(eq(payments.id, payment.id));
            if (current.providerTransactionId) await tx.update(payments).set({ status: 'REFUNDED', refundedAt: new Date(), updatedAt: new Date() }).where(eq(payments.id, payment.id));
          }
        }
        await tx.update(commandReceipts).set({ status: 'COMPLETED', result, updatedAt: new Date() }).where(eq(commandReceipts.idempotencyKey, command.idempotencyKey));
      });
      return result;
    } finally {
      if (locked) {
        try { await client.query('select pg_advisory_unlock(hashtextextended($1,0))', [lock]); }
        catch { discard = true; }
      }
      client.release(discard);
    }
  }

  private async resolveCharge(db: NodePgDatabase, payment: Payment): Promise<Result> {
    if (payment.chargeResult) return ResultSchema.parse(payment.chargeResult);
    const command = ChargePaymentCommandSchema.parse({ version: 1, orderId: payment.orderId, sagaId: payment.sagaId,
      idempotencyKey: commandKey(payment.sagaId, 'CHARGE_PAYMENT'), operation: 'CHARGE_PAYMENT',
      payload: { customerId: payment.customerId, amountMinor: payment.amountMinor, currency: payment.currency } });
    const result = await this.callProvider(command);
    if (result.outcome !== 'UNKNOWN') {
      await db.update(payments).set({ status: result.outcome === 'SUCCEEDED' ? 'CHARGED' : 'FAILED',
        providerTransactionId: result.outcome === 'SUCCEEDED' && result.operation === 'CHARGE_PAYMENT' ? result.data.providerTransactionId : null,
        chargeResult: result, updatedAt: new Date(),
      }).where(eq(payments.id, payment.id));
    }
    return result;
  }

  private async callProvider(command: PaymentCommand): Promise<Result> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const invocation = command.operation === 'CHARGE_PAYMENT' ? this.provider.charge(command) : this.provider.refund(command);
      const raw = await Promise.race([invocation, new Promise<Result>((resolve) => {
        timer = setTimeout(() => resolve(unknown(command, 'Provider deadline exceeded; retry the same key')), this.providerTimeoutMs);
      })]);
      const result = ResultSchema.parse(raw);
      if (result.operation !== command.operation || result.orderId !== command.orderId || result.sagaId !== command.sagaId || result.idempotencyKey !== command.idempotencyKey) {
        return unknown(command, 'Provider response did not match the pending operation');
      }
      return result;
    } catch {
      return unknown(command, 'Provider response unavailable; retry the same key');
    } finally { clearTimeout(timer); }
  }

  async status(orderId: string) {
    const db = drizzle(this.pool);
    // One SQL snapshot avoids returning payment/refund states from different commits.
    const [row] = await db.select({ payment: payments, refund: refunds }).from(payments)
      .fullJoin(refunds, eq(payments.orderId, refunds.orderId))
      .where(or(eq(payments.orderId, orderId), eq(refunds.orderId, orderId)));
    return row ?? null;
  }
}
