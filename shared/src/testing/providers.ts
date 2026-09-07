import { createHash } from 'node:crypto';
import { CommandSchema, ResultSchema, type Command, type CommandFor, type FailureCode, type Operation, type Result, type ResultFor } from '../contracts.js';
import { commandFingerprint } from '../idempotency.js';
import type { PaymentProvider, ShippingProvider } from '../providers.js';

export type SimulationMode = 'success' | 'reject' | 'timeout-after-success';

// Instance-local fake provider state only. Never use this as durable service state.
class SimulatedProvider {
  private readonly results = new Map<string, { fingerprint: string; result: Result }>();
  private readonly orders = new Map<string, { fingerprint: string; id: string; compensated: boolean }>();
  private readonly tombstones = new Set<string>();

  constructor(private readonly kind: 'payment' | 'shipping', private readonly mode: SimulationMode) {}

  execute<O extends Operation>(input: CommandFor<O>): ResultFor<O> {
    const command = CommandSchema.parse(input);
    const forward = this.kind === 'payment' ? 'CHARGE_PAYMENT' : 'CREATE_SHIPMENT';
    const reverse = this.kind === 'payment' ? 'REFUND_PAYMENT' : 'CANCEL_SHIPMENT';
    if (command.operation !== forward && command.operation !== reverse) {
      throw new Error(`Unsupported ${this.kind} operation: ${command.operation}`);
    }
    const { payload: _, ...metadata } = command;
    const fingerprint = commandFingerprint(command);
    const failed = (code: FailureCode, message: string): Result => ResultSchema.parse({
      ...metadata, outcome: 'FAILED', error: { code, message, retryable: false },
    });
    const finish = (result: Result): ResultFor<O> => structuredClone(result) as ResultFor<O>;
    const cached = this.results.get(command.idempotencyKey);
    if (cached) {
      return finish(cached.fingerprint === fingerprint ? cached.result
        : failed('IDEMPOTENCY_CONFLICT', 'This key was already used with a different command'));
    }

    const order = this.orders.get(command.orderId);
    let result: Result;
    let applied = false;
    if (command.operation === reverse) {
      this.tombstones.add(command.orderId);
      const changed = order !== undefined && !order.compensated;
      if (order) order.compensated = true;
      result = ResultSchema.parse({ ...metadata, outcome: 'SUCCEEDED', data: {
        status: changed ? (this.kind === 'payment' ? 'REFUNDED' : 'CANCELLED') : 'NOOP',
      } });
    } else if (this.tombstones.has(command.orderId)) {
      result = failed('ALREADY_COMPENSATED', 'Forward action is blocked after compensation');
    } else if (order && order.fingerprint !== fingerprint) {
      result = failed('IDEMPOTENCY_CONFLICT', 'This order already has a different forward action');
    } else if (this.mode === 'reject') {
      result = failed(this.kind === 'payment' ? 'PAYMENT_DECLINED' : 'SHIPPING_REJECTED', 'Simulated provider rejection');
    } else {
      const id = order?.id ?? `sim_${this.kind}_${createHash('sha256').update(command.orderId).digest('hex').slice(0, 24)}`;
      if (!order) {
        this.orders.set(command.orderId, { fingerprint, id, compensated: false });
        applied = true;
      }
      result = ResultSchema.parse({ ...metadata, outcome: 'SUCCEEDED', data: this.kind === 'payment'
        ? { status: 'CHARGED', providerTransactionId: id }
        : { status: 'CREATED', providerShipmentId: id },
      });
    }
    this.results.set(command.idempotencyKey, { fingerprint, result });
    if (applied && this.mode === 'timeout-after-success') {
      return finish(ResultSchema.parse({ ...metadata, outcome: 'UNKNOWN', error: {
        code: 'PROVIDER_TIMEOUT', message: 'Action succeeded but its response was lost; retry the same key', retryable: true,
      } }));
    }
    return finish(result);
  }
}

export class SimulatedPaymentProvider implements PaymentProvider {
  private readonly simulator: SimulatedProvider;
  constructor(mode: SimulationMode = 'success') { this.simulator = new SimulatedProvider('payment', mode); }
  async charge(command: CommandFor<'CHARGE_PAYMENT'>): Promise<ResultFor<'CHARGE_PAYMENT'>> {
    return this.simulator.execute<'CHARGE_PAYMENT'>(command);
  }
  async refund(command: CommandFor<'REFUND_PAYMENT'>): Promise<ResultFor<'REFUND_PAYMENT'>> {
    return this.simulator.execute<'REFUND_PAYMENT'>(command);
  }
}

export class SimulatedShippingProvider implements ShippingProvider {
  private readonly simulator: SimulatedProvider;
  constructor(mode: SimulationMode = 'success') { this.simulator = new SimulatedProvider('shipping', mode); }
  async create(command: CommandFor<'CREATE_SHIPMENT'>): Promise<ResultFor<'CREATE_SHIPMENT'>> {
    return this.simulator.execute<'CREATE_SHIPMENT'>(command);
  }
  async cancel(command: CommandFor<'CANCEL_SHIPMENT'>): Promise<ResultFor<'CANCEL_SHIPMENT'>> {
    return this.simulator.execute<'CANCEL_SHIPMENT'>(command);
  }
}
