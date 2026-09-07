import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { commandFingerprint, ResultSchema, type CommandFor, type ShippingProvider, type Result, type ResultFor } from '@saga/shared';
import { simulatedProviderShipments as accounts, simulatedProviderRequests as requests } from '../db/schema.js';
import { failure, success, unknown, type ShippingCommand } from '../shipments/results.js';

export type LocalProviderMode = 'success' | 'reject' | 'timeout-after-success';
export class LocalShippingProvider implements ShippingProvider {
  constructor(private readonly pool: pg.Pool, private readonly mode: LocalProviderMode = 'success') {}
  async create(command: CommandFor<'CREATE_SHIPMENT'>): Promise<ResultFor<'CREATE_SHIPMENT'>> {
    return this.execute(command) as Promise<ResultFor<'CREATE_SHIPMENT'>>;
  }
  async cancel(command: CommandFor<'CANCEL_SHIPMENT'>): Promise<ResultFor<'CANCEL_SHIPMENT'>> {
    return this.execute(command) as Promise<ResultFor<'CANCEL_SHIPMENT'>>;
  }
  private async execute(command: ShippingCommand): Promise<Result> {
    const fingerprint = commandFingerprint(command);
    const response = await drizzle(this.pool).transaction(async (tx) => {
      // Provider-side serialization uses a distinct lock namespace.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`provider:${command.orderId}`}, 0))`);
      const [cached] = await tx.select().from(requests).where(eq(requests.idempotencyKey, command.idempotencyKey));
      if (cached) return { fresh: false, result: cached.fingerprint === fingerprint
        ? ResultSchema.parse(cached.result) : failure(command, 'IDEMPOTENCY_CONFLICT', 'Provider key conflict') };
      const [account] = await tx.select().from(accounts).where(eq(accounts.orderId, command.orderId));
      let result: Result;
      if (account && account.sagaId !== command.sagaId) {
        result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order belongs to another saga');
      } else if (command.operation === 'CANCEL_SHIPMENT') {
        if (!account) {
          await tx.insert(accounts).values({ orderId: command.orderId, sagaId: command.sagaId, status: 'NOOP' });
          result = success(command, { status: 'NOOP' });
        } else {
          await tx.update(accounts).set({ status: account.status === 'NOOP' ? 'NOOP' : 'CANCELLED' }).where(eq(accounts.orderId, command.orderId));
          result = success(command, { status: account.status === 'CREATED' ? 'CANCELLED' : 'NOOP' });
        }
      } else if (account && account.status !== 'CREATED') {
        result = failure(command, 'ALREADY_COMPENSATED', 'Shipment was already compensated');
      } else if (account && account.fingerprint !== fingerprint) {
        result = failure(command, 'IDEMPOTENCY_CONFLICT', 'Order payload changed');
      } else if (this.mode === 'reject') {
        result = failure(command, 'SHIPPING_REJECTED', 'Simulated shipment declined');
      } else {
        const shipmentId = account?.shipmentId ?? `local_${createHash('sha256').update(command.orderId).digest('hex')}`;
        if (!account) await tx.insert(accounts).values({ orderId: command.orderId, sagaId: command.sagaId, fingerprint, status: 'CREATED', shipmentId });
        result = success(command, { status: 'CREATED', providerShipmentId: shipmentId });
      }
      await tx.insert(requests).values({ idempotencyKey: command.idempotencyKey, fingerprint, result });
      return { fresh: true, result };
    });
    if (response.fresh && response.result.outcome === 'SUCCEEDED' && this.mode === 'timeout-after-success') {
      return unknown(command, 'Simulated response loss after provider commit; retry the same key');
    }
    return response.result;
  }
}
