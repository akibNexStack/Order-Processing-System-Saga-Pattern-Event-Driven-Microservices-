import type { ApiError } from "../api/base-query";
import type { OrderState } from "../api/contracts";
export function sameId(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}
export function matchesOrder(state: OrderState, id: string) {
  return (
    sameId(state.order.id, id) &&
    sameId(state.saga.orderId, id) &&
    state.items.every((item) => sameId(item.orderId, id))
  );
}
export function matchesRecords(
  records: ({ orderId: string; sagaId: string } | null)[],
  orderId: string,
  sagaId: string,
) {
  return records.every(
    (record) =>
      !record ||
      (sameId(record.orderId, orderId) && sameId(record.sagaId, sagaId)),
  );
}
export function isMissing(error: unknown, name: string) {
  const e = error as Partial<ApiError> | undefined;
  return (
    e?.status === 404 &&
    !!e.body &&
    typeof e.body === "object" &&
    "error" in e.body &&
    e.body.error === `${name} not found`
  );
}
export function readError(error: unknown) {
  const e = error as Partial<ApiError> | undefined;
  return typeof e?.status === "number"
    ? `Service request failed (HTTP ${e.status}). Retry to check again.`
    : "Unable to verify the service response. Check the connection and retry.";
}
export const manualQueryOptions = {
  refetchOnMountOrArgChange: true,
  refetchOnFocus: false,
  refetchOnReconnect: false,
} as const;
