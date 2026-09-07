import type { ResultCommit } from '@saga/shared/messaging';
import { eq, inArray, sql, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { CommandSchema, ResultSchema, commandFingerprint, type CommandFor, type Result, type FailureCode } from '@saga/shared';
import { commandReceipts, products, reservations, reservationItems } from '../db/schema.js';

type InventoryCommand = CommandFor<'RESERVE_INVENTORY' | 'RELEASE_INVENTORY' | 'FINALIZE_INVENTORY'>;
function response(command: InventoryCommand, body: object): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...metadata, ...body });
}
function failure(command: InventoryCommand, code: FailureCode, message: string): Result {
  return response(command, { outcome: 'FAILED', error: { code, message, retryable: false } });
}
function success(command: InventoryCommand, data: object): Result {
  return response(command, { outcome: 'SUCCEEDED', data });
}

export class InventoryService {
  constructor(private readonly pool: pg.Pool) {}
  async execute(input: InventoryCommand, commit?: ResultCommit): Promise<Result> {
    const parsed = CommandSchema.parse(input);
    if (!['RESERVE_INVENTORY', 'RELEASE_INVENTORY', 'FINALIZE_INVENTORY'].includes(parsed.operation)) throw new Error('Unsupported inventory operation');
    const command = { ...parsed, orderId: parsed.orderId.toLowerCase(), sagaId: parsed.sagaId.toLowerCase(),
      ...(parsed.operation === 'RESERVE_INVENTORY' ? { payload: { items: parsed.payload.items.map(item => ({ ...item, productId: item.productId.toLowerCase() })).sort((a, b) => a.productId.localeCompare(b.productId)) } } : {}),
    } as InventoryCommand;
    const fingerprint = commandFingerprint(command);
    return drizzle(this.pool).transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory:${command.orderId}`}, 0))`);
      await tx.insert(commandReceipts).values({ idempotencyKey: command.idempotencyKey, orderId: command.orderId, sagaId: command.sagaId,
        operation: command.operation, fingerprint }).onConflictDoNothing();
      const [receipt] = await tx.select().from(commandReceipts).where(eq(commandReceipts.idempotencyKey, command.idempotencyKey));
      if (receipt.fingerprint !== fingerprint) return failure(command, 'IDEMPOTENCY_CONFLICT', 'This key was used with another command');
      if (receipt.status === 'COMPLETED') return ResultSchema.parse(receipt.result);
      const [existing] = await tx.select().from(reservations).where(eq(reservations.orderId, command.orderId));
      let result: Result;
      if (existing && existing.sagaId !== command.sagaId) {
        result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order belongs to another saga');
      } else if (command.operation === 'RESERVE_INVENTORY') {
        if (existing?.reserveFingerprint && existing.reserveFingerprint !== fingerprint) {
          result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Reservation items cannot change');
        } else if (existing?.status === 'RELEASED') {
          result = failure(command, 'ALREADY_COMPENSATED', 'Reservation was released');
        } else if (existing?.status === 'FINALIZED') {
          result = failure(command, 'INVALID_STATE', 'Reservation is already finalized');
        } else if (existing?.reserveResult) {
          const saved = ResultSchema.parse(existing.reserveResult);
          const { payload: _, ...metadata } = command;
          result = ResultSchema.parse({ ...saved, ...metadata });
        } else {
          const reservation = existing ?? (await tx.insert(reservations).values({ orderId: command.orderId, sagaId: command.sagaId }).returning())[0];
          const requested = command.payload.items;
          // Every operation locks products in UUID order, including releases.
          const stock = await tx.select().from(products).where(inArray(products.id, requested.map(item => item.productId))).orderBy(asc(products.id)).for('update');
          const available = new Map(stock.map(product => [product.id, product.availableStock]));
          if (requested.some(item => (available.get(item.productId) ?? -1) < item.quantity)) {
            result = failure(command, 'INSUFFICIENT_STOCK', 'One or more products are missing or have insufficient stock');
            await tx.update(reservations).set({ status: 'FAILED', reserveFingerprint: fingerprint, reserveResult: result, updatedAt: new Date() }).where(eq(reservations.id, reservation.id));
          } else {
            for (const item of requested) {
              await tx.update(products).set({ availableStock: sql`${products.availableStock} - ${item.quantity}`, updatedAt: new Date() }).where(eq(products.id, item.productId));
            }
            await tx.insert(reservationItems).values(requested.map(item => ({ reservationId: reservation.id, ...item })));
            result = success(command, { status: 'RESERVED', reservationId: reservation.id });
            await tx.update(reservations).set({ status: 'RESERVED', expiresAt: null, reserveFingerprint: fingerprint, reserveResult: result, updatedAt: new Date() }).where(eq(reservations.id, reservation.id));
          }
        }
      } else if (command.operation === 'RELEASE_INVENTORY') {
        if (!existing) {
          await tx.insert(reservations).values({ orderId: command.orderId, sagaId: command.sagaId, status: 'RELEASED' });
          result = success(command, { status: 'NOOP' });
        } else if (existing.status === 'FINALIZED') {
          result = failure(command, 'INVALID_STATE', 'Finalized stock cannot be released by saga compensation');
        } else if (existing.status === 'RESERVED') {
          const items = await tx.select().from(reservationItems).where(eq(reservationItems.reservationId, existing.id)).orderBy(asc(reservationItems.productId));
          if (items.length === 0) throw new Error('Reserved inventory has no items');
          await tx.select({ id: products.id }).from(products).where(inArray(products.id, items.map(item => item.productId))).orderBy(asc(products.id)).for('update');
          for (const item of items) {
            await tx.update(products).set({ availableStock: sql`${products.availableStock} + ${item.quantity}`, updatedAt: new Date() }).where(eq(products.id, item.productId));
          }
          await tx.update(reservations).set({ status: 'RELEASED', expiresAt: null, updatedAt: new Date() }).where(eq(reservations.id, existing.id));
          result = success(command, { status: 'RELEASED' });
        } else if (existing.status === 'FAILED' || existing.status === 'RELEASED') {
          await tx.update(reservations).set({ status: 'RELEASED', expiresAt: null, updatedAt: new Date() }).where(eq(reservations.id, existing.id));
          result = success(command, { status: 'NOOP' });
        } else {
          result = failure(command, 'INVALID_STATE', 'Reservation needs reconciliation before release');
        }
      } else {
        if (existing?.status === 'RESERVED' || existing?.status === 'FINALIZED') {
          await tx.update(reservations).set({ status: 'FINALIZED', expiresAt: null, updatedAt: new Date() }).where(eq(reservations.id, existing.id));
          result = success(command, { status: 'FINALIZED', reservationId: existing.id });
        } else {
          result = failure(command, 'INVALID_STATE', 'Only reserved inventory can be finalized');
        }
      }
      await tx.update(commandReceipts).set({ status: 'COMPLETED', result, updatedAt: new Date() }).where(eq(commandReceipts.idempotencyKey, command.idempotencyKey));
      await commit?.(tx, result);
      return result;
    });
  }

  async status(orderId: string) {
    const rows = await drizzle(this.pool).select({ reservation: reservations, item: reservationItems }).from(reservations)
      .leftJoin(reservationItems, eq(reservations.id, reservationItems.reservationId)).where(eq(reservations.orderId, orderId)).orderBy(asc(reservationItems.productId));
    if (!rows.length) return null;
    return { reservation: rows[0].reservation, items: rows.flatMap(row => row.item ? [row.item] : []) };
  }
}
