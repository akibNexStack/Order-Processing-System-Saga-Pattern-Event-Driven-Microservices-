import {
  CommandSchema,
  commandKey,
  type Command,
  type OrderPayload,
  type SagaStep,
} from '@saga/shared';

export const FORWARD_OPERATIONS = [
  'CHARGE_PAYMENT',
  'RESERVE_INVENTORY',
  'CREATE_SHIPMENT',
  'FINALIZE_INVENTORY',
] as const;

export type ForwardOperation = (typeof FORWARD_OPERATIONS)[number];

export const STEP_FOR_OPERATION: Record<ForwardOperation, SagaStep> = {
  CHARGE_PAYMENT: 'PAYMENT',
  RESERVE_INVENTORY: 'INVENTORY',
  CREATE_SHIPMENT: 'SHIPPING',
  FINALIZE_INVENTORY: 'SHIPPING',
};

// The forwardOperation function validates a given string value against the defined forward operations. If the value is a valid forward operation, it returns it as a ForwardOperation type; otherwise, it throws an error indicating that the persisted operation is invalid. This ensures that only recognized operations are processed in the saga workflow.
export function forwardOperation(value: string): ForwardOperation {
  if (!FORWARD_OPERATIONS.includes(value as ForwardOperation))
    throw new Error('Invalid persisted operation');
  return value as ForwardOperation;
}

// The buildCommand function constructs a Command object based on the provided operation, order ID, saga ID, and order payload. It determines the appropriate payload structure for each operation type and ensures that the resulting command adheres to the expected schema. This function is essential for generating commands that can be sent to external services as part of the saga orchestration process.
export function buildCommand(
  operation: ForwardOperation | 'REFUND_PAYMENT' | 'RELEASE_INVENTORY' | 'CANCEL_SHIPMENT',
  orderId: string,
  sagaId: string,
  order: OrderPayload,
): Command {
  const payload =
    operation === 'CHARGE_PAYMENT'
      ? {
          customerId: order.customerId,
          amountMinor: order.amountMinor,
          currency: order.currency,
          paymentMethod: order.paymentMethod ?? 'COD',
        }
      : operation === 'RESERVE_INVENTORY'
        ? { items: order.items }
        : operation === 'CREATE_SHIPMENT'
          ? { items: order.items, shippingAddress: order.shippingAddress }
          : {};
  return CommandSchema.parse({
    version: 1,
    orderId,
    sagaId,
    operation,
    idempotencyKey: commandKey(sagaId, operation),
    payload,
  });
}
