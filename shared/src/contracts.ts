import { z } from 'zod';

export const IdSchema = z.uuid();
export const IdempotencyKeySchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9:_-]+$/);
export const CurrencySchema = z.enum(['USD', 'BDT']);
// Both supported currencies have two decimal places. Fits DECIMAL(10,2).
export const AmountMinorSchema = z.number().int().min(1).max(9_999_999_999);
const text = z.string().trim().min(1).max(200);
export const AddressSchema = z.strictObject({
  recipient: text,
  line1: text,
  line2: text.optional(),
  city: text,
  region: text.optional(),
  postalCode: z.string().trim().min(1).max(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});
export const ItemsSchema = z.array(z.strictObject({
  productId: IdSchema,
  quantity: z.number().int().min(1).max(10_000),
})).min(1).max(100).refine(
  (items) => new Set(items.map((item) => item.productId.toLowerCase())).size === items.length,
  'Each product must appear only once',
);
export const OrderPayloadSchema = z.strictObject({
  customerId: IdSchema,
  items: ItemsSchema,
  amountMinor: AmountMinorSchema,
  currency: CurrencySchema,
  shippingAddress: AddressSchema,
});
export const CreateOrderRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  payload: OrderPayloadSchema,
});
export const SagaStatusSchema = z.enum(['IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED']);
export const SagaStepSchema = z.enum(['PAYMENT', 'INVENTORY', 'SHIPPING']);
export const FORWARD_STEPS = ['PAYMENT', 'INVENTORY', 'SHIPPING'] as const;
export const OperationSchema = z.enum([
  'CHARGE_PAYMENT', 'REFUND_PAYMENT', 'RESERVE_INVENTORY',
  'RELEASE_INVENTORY', 'CREATE_SHIPMENT', 'CANCEL_SHIPMENT',
]);
export const COMPENSATION_OPERATIONS = {
  PAYMENT: 'REFUND_PAYMENT', INVENTORY: 'RELEASE_INVENTORY', SHIPPING: 'CANCEL_SHIPMENT',
} as const;

const metadata = {
  version: z.literal(1),
  orderId: IdSchema,
  sagaId: IdSchema,
  idempotencyKey: IdempotencyKeySchema,
};
export const ChargePaymentCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('CHARGE_PAYMENT'),
  payload: z.strictObject({ customerId: IdSchema, amountMinor: AmountMinorSchema, currency: CurrencySchema }),
});
export const RefundPaymentCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('REFUND_PAYMENT'), payload: z.strictObject({}),
});
export const ReserveInventoryCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('RESERVE_INVENTORY'), payload: z.strictObject({ items: ItemsSchema }),
});
export const ReleaseInventoryCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('RELEASE_INVENTORY'), payload: z.strictObject({}),
});
export const CreateShipmentCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('CREATE_SHIPMENT'),
  payload: z.strictObject({ items: ItemsSchema, shippingAddress: AddressSchema }),
});
export const CancelShipmentCommandSchema = z.strictObject({
  ...metadata, operation: z.literal('CANCEL_SHIPMENT'), payload: z.strictObject({}),
});
export const CommandSchema = z.discriminatedUnion('operation', [
  ChargePaymentCommandSchema, RefundPaymentCommandSchema, ReserveInventoryCommandSchema,
  ReleaseInventoryCommandSchema, CreateShipmentCommandSchema, CancelShipmentCommandSchema,
]);

const success = { ...metadata, outcome: z.literal('SUCCEEDED') };
export const SuccessResultSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...success, operation: z.literal('CHARGE_PAYMENT'), data: z.strictObject({ status: z.literal('CHARGED'), providerTransactionId: text }) }),
  z.strictObject({ ...success, operation: z.literal('REFUND_PAYMENT'), data: z.strictObject({ status: z.enum(['REFUNDED', 'NOOP']) }) }),
  z.strictObject({ ...success, operation: z.literal('RESERVE_INVENTORY'), data: z.strictObject({ status: z.literal('RESERVED'), reservationId: IdSchema }) }),
  z.strictObject({ ...success, operation: z.literal('RELEASE_INVENTORY'), data: z.strictObject({ status: z.enum(['RELEASED', 'NOOP']) }) }),
  z.strictObject({ ...success, operation: z.literal('CREATE_SHIPMENT'), data: z.strictObject({ status: z.literal('CREATED'), providerShipmentId: text }) }),
  z.strictObject({ ...success, operation: z.literal('CANCEL_SHIPMENT'), data: z.strictObject({ status: z.enum(['CANCELLED', 'NOOP']) }) }),
]);
export const FailureCodeSchema = z.enum([
  'PAYMENT_DECLINED', 'INSUFFICIENT_STOCK', 'SHIPPING_REJECTED',
  'IDEMPOTENCY_CONFLICT', 'ALREADY_COMPENSATED', 'INVALID_STATE',
]);
export const FailureResultSchema = z.strictObject({
  ...metadata, operation: OperationSchema, outcome: z.literal('FAILED'),
  error: z.strictObject({ code: FailureCodeSchema, message: text, retryable: z.literal(false) }),
});
export const UnknownResultSchema = z.strictObject({
  ...metadata, operation: OperationSchema, outcome: z.literal('UNKNOWN'),
  error: z.strictObject({ code: z.enum(['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE']), message: text, retryable: z.literal(true) }),
});
export const ResultSchema = z.union([SuccessResultSchema, FailureResultSchema, UnknownResultSchema]);

export type OrderPayload = z.infer<typeof OrderPayloadSchema>;
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export type ShippingAddress = z.infer<typeof AddressSchema>;
export type OrderItems = z.infer<typeof ItemsSchema>;
export type SagaStatus = z.infer<typeof SagaStatusSchema>;
export type SagaStep = z.infer<typeof SagaStepSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Result = z.infer<typeof ResultSchema>;
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type CommandFor<O extends Operation> = Extract<Command, { operation: O }>;
export type ResultFor<O extends Operation> =
  | Extract<z.infer<typeof SuccessResultSchema>, { operation: O }>
  | (Omit<z.infer<typeof FailureResultSchema>, 'operation'> & { operation: O })
  | (Omit<z.infer<typeof UnknownResultSchema>, 'operation'> & { operation: O });
