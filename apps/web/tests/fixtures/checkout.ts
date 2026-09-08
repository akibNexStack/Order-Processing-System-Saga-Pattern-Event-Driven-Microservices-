import type { Page } from "@playwright/test";
import type { CreateOrderRequest } from "@saga/shared/contracts";
import type { OrderState } from "../../src/lib/api/contracts";
export const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const payload: CreateOrderRequest["payload"] = {
  customerId: "11111111-1111-4111-8111-111111111111",
  items: [{ productId: "44444444-4444-4444-8444-444444444444", quantity: 2 }],
  amountMinor: 29,
  currency: "BDT",
  shippingAddress: {
    recipient: "Private Demo User",
    line1: "Private Test Road",
    city: "Dhaka",
    postalCode: "1200",
    countryCode: "BD",
  },
};
export function orderReply(
  request: CreateOrderRequest,
  status = 202,
): OrderState {
  const time = "2026-09-08T06:00:00.000Z";
  return {
    order: {
      id: orderId,
      ...request.payload,
      idempotencyKey: request.idempotencyKey,
      createdAt: time,
    },
    saga: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      orderId,
      createdAt: time,
      updatedAt: time,
      status:
        status === 422
          ? "FAILED"
          : status === 202
            ? "IN_PROGRESS"
            : "COMPLETED",
      currentStep: "PAYMENT",
      currentOperation: "CHARGE_PAYMENT",
      completedSteps: [],
      compensatedSteps: [],
      inventoryFinalized: false,
      lastResult: null,
      payload: request.payload,
      version: 1,
      attempts: 0,
      brokerAttempts: 0,
      recoveryAttempts: 0,
      pendingMessageId: null,
      interventionReason: null,
      responseDeadlineAt: null,
      nextAttemptAt: time,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    items: request.payload.items.map((item) => ({ ...item, orderId })),
    transitions: [],
    requiresCompensation: false,
    requiresManualIntervention: false,
  };
}
export async function fillCheckout(page: Page) {
  for (const [name, value] of Object.entries({
    "Customer ID": payload.customerId,
    Amount: "0.29",
    Recipient: payload.shippingAddress.recipient,
    "Address line 1": payload.shippingAddress.line1,
    City: "Dhaka",
    "Postal code": "1200",
    "Country code": "BD",
  })) {
    await page.getByRole("textbox", { name, exact: true }).fill(value);
  }
  await page.getByRole("checkbox", { name: /Demo Keyboard/ }).check();
  await page
    .getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    })
    .fill("2");
}
