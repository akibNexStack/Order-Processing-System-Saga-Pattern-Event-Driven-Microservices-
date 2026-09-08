import type { CreateOrderRequest, OrderPayload } from "@saga/shared/contracts";
import { OrderStateSchema, type OrderState } from "../api/contracts";
import type { ApiResponse, ApiError } from "../api/base-query";
import type {
  CheckoutStore,
  SubmissionReceipt,
} from "../../stores/checkout-store";

const addressKey = (address: OrderPayload["shippingAddress"]) => [
  address.recipient,
  address.line1,
  address.line2 ?? "",
  address.city,
  address.region ?? "",
  address.postalCode,
  address.countryCode,
];
const itemsKey = (items: OrderPayload["items"]) =>
  items
    .map((item) => [item.productId.toLowerCase(), item.quantity] as const)
    .sort(([a], [b]) => a.localeCompare(b));
const payloadKey = (payload: OrderPayload) =>
  JSON.stringify([
    payload.customerId.toLowerCase(),
    payload.amountMinor,
    payload.currency,
    addressKey(payload.shippingAddress),
    itemsKey(payload.items),
  ]);

// A schema-valid response is not enough: it must describe THIS checkout.
export function matchesSubmission(
  state: OrderState,
  request: CreateOrderRequest,
) {
  return (
    state.order.id.toLowerCase() === state.saga.orderId.toLowerCase() &&
    state.order.idempotencyKey === request.idempotencyKey &&
    payloadKey(state.saga.payload) === payloadKey(request.payload) &&
    payloadKey({ ...state.order, items: state.items }) ===
      payloadKey(request.payload) &&
    state.items.every(
      (item) => item.orderId.toLowerCase() === state.order.id.toLowerCase(),
    )
  );
}

export function retryDeadline(value?: string | null, now = Date.now()) {
  if (!value) return 0;
  const milliseconds = /^\d+$/.test(value.trim())
    ? now + Number(value) * 1000
    : Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > now ? milliseconds : 0;
}

type Send = (request: CreateOrderRequest) => Promise<ApiResponse<OrderState>>;
// The store owns the lock and immutable snapshot; completion survives page unmount.
export async function submitCheckout(
  store: CheckoutStore,
  send: Send,
  remember: (id: string) => unknown,
  retry = false,
): Promise<SubmissionReceipt | null> {
  const request = retry
    ? store.getState().retrySubmission()
    : store.getState().beginSubmission();
  if (!request) return null;
  let receipt: SubmissionReceipt;
  try {
    const reply = await send(request);
    const parsed = OrderStateSchema.safeParse(reply.body);
    if (
      !parsed.success ||
      !matchesSubmission(parsed.data, request) ||
      ![200, 201, 202, 422].includes(reply.status) ||
      (reply.status === 422 && parsed.data.saga.status !== "FAILED") ||
      ([200, 201].includes(reply.status) &&
        parsed.data.saga.status !== "COMPLETED") ||
      (reply.status === 202 &&
        ["COMPLETED", "FAILED"].includes(parsed.data.saga.status))
    ) {
      throw {
        status: "INVALID_RESPONSE",
        message: "Unverified order response",
        retryAfter: reply.retryAfter,
      };
    }
    receipt = {
      orderId: parsed.data.order.id.toLowerCase(),
      status: reply.status,
      message:
        reply.status === 202
          ? "Order accepted. Processing is not complete; do not submit it as a new checkout."
          : reply.status === 422
            ? "Order saved, but its saga failed. This is not a successful purchase. Review the order before trying again."
            : "Order completed successfully.",
    };
  } catch (cause) {
    const error = (
      cause && typeof cause === "object" ? cause : {}
    ) as Partial<ApiError>;
    if (
      [400, 409].includes(Number(error.status)) &&
      error.body &&
      typeof error.body === "object" &&
      "error" in error.body &&
      typeof error.body.error === "string"
    ) {
      receipt = {
        orderId: null,
        status: Number(error.status),
        message:
          error.status === 409
            ? "Idempotency conflict (409): this key already belongs to a different order. Do not retry it. Verify the existing order before deliberately starting a new checkout."
            : "Order rejected (400): the backend rejected the request. Start a new checkout and correct its details.",
      };
    } else {
      store
        .getState()
        .markUncertain(
          request.idempotencyKey,
          `${error.status === 503 ? "Order service unavailable (503)." : "The order outcome could not be confirmed."} It may already be saved. Retry only the original request with the same key; do not reload or start another checkout.`,
          retryDeadline(error.retryAfter),
        );
      return null;
    }
  }
  if (!store.getState().markSettled(request.idempotencyKey, receipt))
    return null;
  if (receipt.orderId) remember(receipt.orderId);
  return receipt;
}
