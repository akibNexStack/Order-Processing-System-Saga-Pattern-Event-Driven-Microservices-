import { z } from "zod";
import {
  AddressSchema,
  AmountMinorSchema,
  CurrencySchema,
  IdSchema,
  IdempotencyKeySchema,
  ItemsSchema,
  OperationSchema,
  OrderPayloadSchema,
  ResultSchema,
  SagaStatusSchema,
  SagaStepSchema,
} from "@saga/shared/contracts";

// HTTP timestamps are ISO strings, not the Date instances used by database rows.
const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().int().nonnegative();
const direction = z.enum(["FORWARD", "COMPENSATION"]);
const record = {
  id: IdSchema,
  orderId: IdSchema,
  sagaId: IdSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const OrderStateSchema = z.looseObject({
  order: z.looseObject({
    id: IdSchema,
    customerId: IdSchema,
    idempotencyKey: IdempotencyKeySchema,
    amountMinor: AmountMinorSchema,
    currency: CurrencySchema,
    shippingAddress: AddressSchema,
    createdAt: timestamp,
  }),
  saga: z.looseObject({
    id: IdSchema,
    orderId: IdSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: SagaStatusSchema,
    currentStep: SagaStepSchema,
    currentOperation: OperationSchema,
    completedSteps: z.array(SagaStepSchema),
    compensatedSteps: z.array(SagaStepSchema),
    inventoryFinalized: z.boolean(),
    lastResult: ResultSchema.nullable(),
    payload: OrderPayloadSchema,
    version: counter,
    attempts: counter,
    brokerAttempts: counter,
    recoveryAttempts: counter,
    pendingMessageId: IdSchema.nullable(),
    interventionReason: z.string().nullable(),
    responseDeadlineAt: timestamp.nullable(),
    nextAttemptAt: timestamp,
    leaseOwner: z.string().nullable(),
    leaseExpiresAt: timestamp.nullable(),
  }),
  items: z.array(
    z.looseObject({
      orderId: IdSchema,
      productId: IdSchema,
      quantity: z.number().int().positive(),
    }),
  ),
  transitions: z.array(
    z.looseObject({
      id: IdSchema,
      sagaId: IdSchema,
      sequence: counter,
      fromStatus: SagaStatusSchema.nullable(),
      toStatus: SagaStatusSchema,
      step: SagaStepSchema,
      direction,
      details: z.record(z.string(), z.unknown()),
      createdAt: timestamp,
    }),
  ),
  requiresCompensation: z.boolean(),
  requiresManualIntervention: z.boolean(),
});

export const HistorySchema = z.looseObject({
  orderId: IdSchema,
  status: SagaStatusSchema,
  interventionReason: z.string().nullable(),
  history: z.array(
    z.looseObject({
      sequence: counter,
      at: timestamp,
      step: SagaStepSchema,
      direction,
      from: SagaStatusSchema.nullable(),
      to: SagaStatusSchema,
      summary: z.string(),
      event: z.string().optional(),
      operation: OperationSchema.optional(),
      messageId: IdSchema.nullable().optional(),
      reason: z.string().nullable().optional(),
    }),
  ),
});

export const AttentionSchema = z.looseObject({
  limit: z.number().int().positive().max(100),
  orders: z.array(
    z.looseObject({
      orderId: IdSchema,
      sagaId: IdSchema,
      status: SagaStatusSchema,
      operation: OperationSchema,
      reason: z.string().nullable(),
      updatedAt: timestamp,
    }),
  ).max(100),
}).refine(value => value.orders.length <= value.limit &&
  new Set(value.orders.map(order => order.orderId.toLowerCase())).size === value.orders.length,
  "Invalid attention list size or duplicate order IDs");

export const PaymentStateSchema = z.looseObject({
  payment: z
    .looseObject({
      ...record,
      customerId: IdSchema,
      amountMinor: AmountMinorSchema,
      currency: CurrencySchema,
      status: z.enum(["PENDING", "CHARGED", "REFUNDED", "FAILED"]),
      providerTransactionId: z.string().nullable(),
      chargeResult: ResultSchema.nullable(),
      refundedAt: timestamp.nullable(),
    })
    .nullable(),
  refund: z
    .looseObject({
      ...record,
      paymentId: IdSchema.nullable(),
      providerRefundId: z.string().nullable(),
      status: z.enum(["PENDING", "REFUNDED", "NOOP"]),
    })
    .nullable(),
});

export const ReservationStateSchema = z.looseObject({
  reservation: z.looseObject({
    ...record,
    status: z.enum(["PENDING", "RESERVED", "RELEASED", "FINALIZED", "FAILED"]),
    expiresAt: timestamp.nullable(),
    reserveFingerprint: z.string().nullable(),
    reserveResult: ResultSchema.nullable(),
  }),
  items: z.array(
    z.looseObject({
      reservationId: IdSchema,
      productId: IdSchema,
      quantity: z.number().int().positive(),
    }),
  ),
});

export const ShipmentStateSchema = z.looseObject({
  shipment: z
    .looseObject({
      ...record,
      shippingAddress: AddressSchema,
      items: ItemsSchema,
      status: z.enum(["PENDING", "CREATED", "CANCELLED", "FAILED"]),
      providerShipmentId: z.string().nullable(),
      createResult: ResultSchema.nullable(),
      cancelledAt: timestamp.nullable(),
    })
    .nullable(),
  cancellation: z
    .looseObject({
      ...record,
      shipmentId: IdSchema.nullable(),
      status: z.enum(["PENDING", "CANCELLED", "NOOP"]),
    })
    .nullable(),
});

export const serviceNames = [
  "orders",
  "payment",
  "inventory",
  "shipping",
] as const;
export type ServiceName = (typeof serviceNames)[number];
export const serviceIdentities: Record<ServiceName, string> = {
  orders: "order-orchestrator",
  payment: "payment-service",
  inventory: "inventory-service",
  shipping: "shipping-service",
};
export const HealthSchema = z.looseObject({
  service: z.enum([
    "order-orchestrator",
    "payment-service",
    "inventory-service",
    "shipping-service",
  ]),
  status: z.literal("ok"),
});
export const ReadinessSchema = z
  .looseObject({
    status: z.enum(["ready", "not_ready"]),
    checks: z.union([
      z.looseObject({
        database: z.boolean(),
        broker: z.boolean(),
        recovery: z.boolean().optional(),
      }),
      z.object({ configured: z.literal(false) }),
    ]),
  })
  .refine(
    (value) =>
      value.status !== "ready" ||
      ("database" in value.checks &&
        value.checks.database &&
        value.checks.broker &&
        value.checks.recovery !== false),
    "Ready responses must not contain failed dependency checks",
  );

export type OrderState = z.infer<typeof OrderStateSchema>;
export type OrderHistory = z.infer<typeof HistorySchema>;
export type AttentionList = z.infer<typeof AttentionSchema>;
export type PaymentState = z.infer<typeof PaymentStateSchema>;
export type ReservationState = z.infer<typeof ReservationStateSchema>;
export type ShipmentState = z.infer<typeof ShipmentStateSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type Readiness = z.infer<typeof ReadinessSchema>;
