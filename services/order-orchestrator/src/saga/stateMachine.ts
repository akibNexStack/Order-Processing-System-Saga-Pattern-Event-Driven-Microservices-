import { CommandSchema, commandKey, type Command, type OrderPayload, type SagaStep } from '@saga/shared';

export const FORWARD_OPERATIONS = ['CHARGE_PAYMENT', 'RESERVE_INVENTORY', 'CREATE_SHIPMENT', 'FINALIZE_INVENTORY'] as const;
export type ForwardOperation = typeof FORWARD_OPERATIONS[number];
export const STEP_FOR_OPERATION: Record<ForwardOperation, SagaStep> = {
  CHARGE_PAYMENT: 'PAYMENT', RESERVE_INVENTORY: 'INVENTORY', CREATE_SHIPMENT: 'SHIPPING', FINALIZE_INVENTORY: 'SHIPPING',
};
export function forwardOperation(value: string): ForwardOperation {
  if (!FORWARD_OPERATIONS.includes(value as ForwardOperation)) throw new Error('Invalid persisted operation');
  return value as ForwardOperation;
}
export function buildCommand(operation: ForwardOperation | 'REFUND_PAYMENT' | 'RELEASE_INVENTORY' | 'CANCEL_SHIPMENT', orderId: string, sagaId: string, order: OrderPayload): Command {
  const payload = operation === 'CHARGE_PAYMENT' ? { customerId: order.customerId, amountMinor: order.amountMinor, currency: order.currency }
    : operation === 'RESERVE_INVENTORY' ? { items: order.items }
    : operation === 'CREATE_SHIPMENT' ? { items: order.items, shippingAddress: order.shippingAddress } : {};
  return CommandSchema.parse({ version: 1, orderId, sagaId, operation, idempotencyKey: commandKey(sagaId, operation), payload });
}
