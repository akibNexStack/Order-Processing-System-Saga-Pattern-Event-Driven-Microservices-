import { eq, or } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { CreateShipmentCommandSchema, CancelShipmentCommandSchema, ResultSchema, commandFingerprint, commandKey, type ShippingProvider, type Result } from '@saga/shared';
import { commandReceipts, shipments, shipmentCancellations } from '../db/schema.js';
import { failure, resultFor, success, unknown, type ShippingCommand } from './results.js';

type Shipment = typeof shipments.$inferSelect;
export class ShippingService {
  constructor(private readonly pool: pg.Pool, private readonly provider: ShippingProvider, private readonly providerTimeoutMs = 5000) {}

  async execute(input: ShippingCommand): Promise<Result> {
    const parsed = input.operation === 'CREATE_SHIPMENT' ? CreateShipmentCommandSchema.parse(input) : CancelShipmentCommandSchema.parse(input);
    const command: ShippingCommand = { ...parsed, orderId: parsed.orderId.toLowerCase(), sagaId: parsed.sagaId.toLowerCase(),
      ...(parsed.operation === 'CREATE_SHIPMENT' ? { payload: { ...parsed.payload, items: parsed.payload.items.map(item => ({ ...item, productId: item.productId.toLowerCase() })).sort((a, b) => a.productId.localeCompare(b.productId)) } } : {}),
    } as ShippingCommand;
    const client = await this.pool.connect();
    const lock = `shipping-service:${command.orderId}`;
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

      const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, command.orderId));
      const [cancellation] = await db.select().from(shipmentCancellations).where(eq(shipmentCancellations.orderId, command.orderId));
      let result: Result;
      if ((shipment && shipment.sagaId !== command.sagaId) || (cancellation && cancellation.sagaId !== command.sagaId)) {
        result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order belongs to another saga');
      } else if (command.operation === 'CREATE_SHIPMENT') {
        if (shipment && commandFingerprint({ ...command, payload: { items: shipment.items, shippingAddress: shipment.shippingAddress } }) !== commandFingerprint(command)) {
          result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order shipment details cannot change');
        } else if (cancellation || shipment?.status === 'CANCELLED') {
          result = failure(command, 'ALREADY_COMPENSATED', 'Shipment has a compensation request');
        } else {
          const existing = shipment ?? (await db.insert(shipments).values({ orderId: command.orderId, sagaId: command.sagaId, ...command.payload }).returning())[0];
          result = resultFor(command, await this.resolveCreate(db, existing));
        }
      } else {
        await db.insert(shipmentCancellations).values({ orderId: command.orderId, sagaId: command.sagaId, shipmentId: shipment?.id }).onConflictDoNothing();
        if (cancellation?.status === 'CANCELLED' || cancellation?.status === 'NOOP') {
          result = success(command, { status: cancellation.status });
        } else {
          let createResult: Result | undefined;
          if (shipment?.status === 'PENDING') createResult = await this.resolveCreate(db, shipment);
          if (createResult?.outcome === 'UNKNOWN') {
            result = unknown(command, 'Original shipment creation is unresolved; retry cancellation with the same key');
          } else if (!shipment || shipment.status === 'FAILED' || createResult?.outcome === 'FAILED') {
            result = success(command, { status: 'NOOP' });
          } else {
            result = resultFor(command, await this.callProvider({ ...command, idempotencyKey: commandKey(command.sagaId, command.operation) }));
          }
        }
      }
      if (result.outcome === 'UNKNOWN') return result;
      // A failed cancellation remains pending and retryable with its original key. It must
      // never be mistaken for completed compensation by an orchestrator.
      if (command.operation === 'CANCEL_SHIPMENT' && result.outcome === 'FAILED') return result;
      await db.transaction(async (tx) => {
        if (command.operation === 'CANCEL_SHIPMENT' && result.outcome === 'SUCCEEDED' && result.operation === 'CANCEL_SHIPMENT') {
          await tx.update(shipmentCancellations).set({ status: result.data.status, updatedAt: new Date() }).where(eq(shipmentCancellations.orderId, command.orderId));
          if (shipment) {
            // Re-read because resolving a pending create may have set CREATED/FAILED.
            const [current] = await tx.select().from(shipments).where(eq(shipments.id, shipment.id));
            if (current.providerShipmentId) await tx.update(shipments).set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(shipments.id, shipment.id));
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

  private async resolveCreate(db: NodePgDatabase, shipment: Shipment): Promise<Result> {
    if (shipment.createResult) return ResultSchema.parse(shipment.createResult);
    const command = CreateShipmentCommandSchema.parse({ version: 1, orderId: shipment.orderId, sagaId: shipment.sagaId,
      idempotencyKey: commandKey(shipment.sagaId, 'CREATE_SHIPMENT'), operation: 'CREATE_SHIPMENT',
      payload: { items: shipment.items, shippingAddress: shipment.shippingAddress } });
    const result = await this.callProvider(command);
    if (result.outcome !== 'UNKNOWN') {
      await db.update(shipments).set({ status: result.outcome === 'SUCCEEDED' ? 'CREATED' : 'FAILED',
        providerShipmentId: result.outcome === 'SUCCEEDED' && result.operation === 'CREATE_SHIPMENT' ? result.data.providerShipmentId : null,
        createResult: result, updatedAt: new Date(),
      }).where(eq(shipments.id, shipment.id));
    }
    return result;
  }

  private async callProvider(command: ShippingCommand): Promise<Result> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const invocation = command.operation === 'CREATE_SHIPMENT' ? this.provider.create(command) : this.provider.cancel(command);
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
    // One SQL snapshot avoids returning shipment/cancellation states from different commits.
    const [row] = await db.select({ shipment: shipments, cancellation: shipmentCancellations }).from(shipments)
      .fullJoin(shipmentCancellations, eq(shipments.orderId, shipmentCancellations.orderId))
      .where(or(eq(shipments.orderId, orderId), eq(shipmentCancellations.orderId, orderId)));
    return row ?? null;
  }
}
