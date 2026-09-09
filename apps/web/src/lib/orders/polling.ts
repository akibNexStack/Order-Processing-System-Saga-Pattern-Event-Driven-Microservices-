import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { ApiError } from "../api/base-query";
import type { OrderState } from "../api/contracts";
import { sagaApi } from "../api/api";
import type { AppStore } from "../store";

export function pollingDelay(order: OrderState | undefined, error: unknown, failures: number) {
  if (order && (["COMPLETED", "FAILED"].includes(order.saga.status) || order.requiresManualIntervention))
    return null;
  if (error) {
    const status = (error as Partial<ApiError>).status;
    const temporary = status === "FETCH_ERROR" || status === "TIMEOUT_ERROR" ||
      status === 408 || status === 429 || (typeof status === "number" && status >= 500);
    return temporary ? Math.min(2_000 * 2 ** Math.min(failures, 4), 30_000) : null;
  }
  return order ? 2_000 : null;
}

// The details route owns these GETs, including initial subscriptions, manual
// refresh, polling, and requests started by mutation invalidation.
export function cancelOrderReads(dispatch: AppStore["dispatch"], orderId: string) {
  for (const endpoint of ["getOrder", "getPayment", "getReservation", "getShipment"] as const)
    dispatch(sagaApi.util.getRunningQueryThunk(endpoint, orderId))?.abort();
}

export function useOrderPolling({
  orderId, order, error, isFetching, requestId, refetch,
}: {
  orderId: string;
  order?: OrderState;
  error?: unknown;
  isFetching: boolean;
  requestId?: string;
  refetch: () => unknown;
}) {
  const dispatch = useDispatch<AppStore["dispatch"]>();
  const retry = useRef({ requestId: undefined as string | undefined, failures: 0 });
  const lifetime = useRef(0);
  useEffect(() => {
    const generation = ++lifetime.current;
    return () => {
      // Strict Mode immediately reconnects effects. Cancel only a real departure.
      queueMicrotask(() => {
        if (lifetime.current === generation) cancelOrderReads(dispatch, orderId);
      });
    };
  }, [dispatch, orderId]);

  const delay = pollingDelay(order, error, Math.max(1, retry.current.failures));
  useEffect(() => {
    if (isFetching) return;
    if (retry.current.requestId !== requestId) {
      retry.current = { requestId, failures: error ? retry.current.failures + 1 : 0 };
    }
    const nextDelay = pollingDelay(order, error, retry.current.failures);
    if (nextDelay === null) return;
    // RTK Query deduplicates manual refresh and invalidation with this GET.
    // Pending state clears this timeout; a settled response starts a fresh one.
    const timer = window.setTimeout(() => { refetch(); }, nextDelay);
    return () => window.clearTimeout(timer);
  }, [order, error, isFetching, requestId, refetch]);
  return { isPolling: delay !== null };
}
