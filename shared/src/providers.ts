import type { CommandFor, ResultFor } from './contracts.js';

export interface PaymentProvider {
  charge(command: CommandFor<'CHARGE_PAYMENT'>): Promise<ResultFor<'CHARGE_PAYMENT'>>;
  refund(command: CommandFor<'REFUND_PAYMENT'>): Promise<ResultFor<'REFUND_PAYMENT'>>;
}

export interface ShippingProvider {
  create(command: CommandFor<'CREATE_SHIPMENT'>): Promise<ResultFor<'CREATE_SHIPMENT'>>;
  cancel(command: CommandFor<'CANCEL_SHIPMENT'>): Promise<ResultFor<'CANCEL_SHIPMENT'>>;
}
