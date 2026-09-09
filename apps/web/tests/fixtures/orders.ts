import type { Page } from "@playwright/test";
import { orderId, orderReply, payload } from "./checkout";
export const orderDetailsFixture = () =>
  orderReply({ payload, idempotencyKey: "fixture-order-key" });
export function participantFixtures() {
  const record = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    orderId,
    sagaId: orderDetailsFixture().saga.id,
    createdAt: "2026-09-08T06:00:00.000Z",
    updatedAt: "2026-09-08T06:01:00.000Z",
  };
  return {
    Payment: {
      payment: {
        ...record,
        customerId: payload.customerId,
        amountMinor: 29,
        currency: "BDT",
        status: "CHARGED",
        providerTransactionId: "payment-demo-123",
        chargeResult: {
          version: 1,
          orderId,
          sagaId: record.sagaId,
          idempotencyKey: "charge-key",
          operation: "CHARGE_PAYMENT",
          outcome: "SUCCEEDED",
          data: {
            status: "CHARGED",
            providerTransactionId: "payment-demo-123",
          },
        },
        refundedAt: null,
      },
      refund: null,
    },
    Reservation: {
      reservation: {
        ...record,
        status: "RESERVED",
        expiresAt: null,
        reserveFingerprint: null,
        reserveResult: null,
      },
      items: [
        {
          reservationId: record.id,
          productId: payload.items[0].productId,
          quantity: 2,
        },
      ],
    },
    Shipment: {
      shipment: {
        ...record,
        shippingAddress: payload.shippingAddress,
        items: payload.items,
        status: "CREATED",
        providerShipmentId: "shipment-demo-123",
        createResult: null,
        cancelledAt: null,
      },
      cancellation: null,
    },
  };
}
export const readPaths = {
  Order: `/api/orders/${orderId}`,
  Payment: `/api/payments/${orderId}`,
  Reservation: `/api/inventory/reservations/${orderId}`,
  Shipment: `/api/shipments/${orderId}`,
};
export async function mockOrderReads(page: Page) {
  await page.route(`**${readPaths.Order}/history`, route => route.fulfill({ json: {
    orderId, status: "IN_PROGRESS", interventionReason: null, history: [],
  } }));
  const data = { Order: orderDetailsFixture(), ...participantFixtures() };
  for (const [name, path] of Object.entries(readPaths))
    await page.route(`**${path}`, (route) =>
      route.fulfill({ json: data[name as keyof typeof data] }),
    );
}
