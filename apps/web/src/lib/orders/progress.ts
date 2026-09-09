import type { Operation, SagaStep } from "@saga/shared/contracts";
import type { OrderState, OrderHistory } from "../api/contracts";
import { sameId } from "./view";

export type ProgressStatus = "Pending" | "Running" | "Succeeded" | "Failed" | "Paused" | "Not needed";
export type ProgressItem = { label: string; operation: Operation; status: ProgressStatus; note: string };
const forward = [
  ["Payment", "CHARGE_PAYMENT", "PAYMENT"],
  ["Inventory reservation", "RESERVE_INVENTORY", "INVENTORY"],
  ["Shipment creation", "CREATE_SHIPMENT", "SHIPPING"],
  ["Inventory finalization", "FINALIZE_INVENTORY", null],
] as const;
const reverse = [
  ["Shipment cancellation", "CANCEL_SHIPMENT", "SHIPPING"],
  ["Inventory release", "RELEASE_INVENTORY", "INVENTORY"],
  ["Payment refund", "REFUND_PAYMENT", "PAYMENT"],
] as const;

export function sagaProgress(state: OrderState) {
  const saga = state.saga;
  const compensating = saga.status === "COMPENSATING" || saga.compensatedSteps.length > 0 ||
    (saga.status === "FAILED" && saga.completedSteps.length > 0);
  const last = saga.lastResult;
  const correlated = last && sameId(last.orderId, state.order.id) && sameId(last.sagaId, saga.id);
  function executing(operation: Operation): Pick<ProgressItem, "status" | "note"> {
    if (state.requiresManualIntervention)
      return { status: "Paused", note: "Waiting for manual intervention; this operation is unfinished." };
    if (correlated && last.operation === operation && last.outcome === "FAILED")
      return { status: "Failed", note: "The last attempt failed. The saga may retry this operation." };
    return { status: "Running", note: correlated && last.operation === operation && last.outcome === "UNKNOWN"
      ? "The result is uncertain. Waiting for reconciliation or a retry."
      : "The saga is working on this operation; it may be queued or awaiting a response." };
  }
  const steps: ProgressItem[] = forward.map(([label, operation, step]) => {
    const succeeded = step ? saga.completedSteps.includes(step) : saga.inventoryFinalized;
    let result: Pick<ProgressItem, "status" | "note"> = { status: "Pending", note: "Not reached yet." };
    if (succeeded) result = { status: "Succeeded", note: step && saga.compensatedSteps.includes(step)
      ? "This operation succeeded earlier and has since been undone." : "The saga recorded this operation as successful." };
    else if (saga.currentOperation === operation) {
      result = compensating || saga.status === "FAILED"
        ? { status: "Failed", note: "This operation prevented the order from completing." }
        : saga.status === "IN_PROGRESS" ? executing(operation) : result;
    }
    if (operation === "FINALIZE_INVENTORY" && !succeeded && compensating)
      result = { status: "Not needed", note: "Stock will not be finalized for this unsuccessful order." };
    return { label, operation, ...result };
  });
  // Backend compensation walks completed forward steps in reverse order.
  const next = reverse.find(([, , step]) => saga.completedSteps.includes(step) && !saga.compensatedSteps.includes(step));
  const compensation: ProgressItem[] = reverse.map(([label, operation, step]) => {
    let result: Pick<ProgressItem, "status" | "note"> = { status: "Not needed", note: "No successful forward operation needs undoing." };
    if (saga.compensatedSteps.includes(step as SagaStep))
      result = { status: "Succeeded", note: "The saga recorded this compensation as successful." };
    else if (saga.completedSteps.includes(step)) {
      result = next?.[1] === operation && saga.status === "COMPENSATING"
        ? executing(operation) : { status: "Pending", note: "Waiting for earlier compensation to finish." };
    }
    return { label, operation, ...result };
  });
  return { steps, compensation: compensating ? compensation : [] };
}

export function orderedHistory(history: OrderHistory, orderId: string) {
  if (!sameId(history.orderId, orderId) ||
    new Set(history.history.map(event => event.sequence)).size !== history.history.length) return null;
  // Sequence is the committed event order, including events with equal timestamps.
  return [...history.history].sort((a, b) => a.sequence - b.sequence);
}

export function explainEvent(event: OrderHistory["history"][number]) {
  const operation = [...forward, ...reverse].find(item => item[1] === event.operation)?.[0];
  const subject = operation ?? "The operation";
  const explanations: Record<string, string> = {
    ORDER_ACCEPTED: "The order was accepted and processing began.",
    COMMAND_DISPATCHED: "An operation was queued for processing. Its result is not yet confirmed.",
    STEP_SUCCEEDED: `${subject} succeeded. The saga can move to the next step.`,
    STEP_REJECTED: event.to === "COMPENSATING"
      ? `${subject} was rejected. Previously completed work is being undone.`
      : `${subject} failed. Check the order status to see whether processing can retry.`,
    FINALIZATION_REJECTED: "Stock finalization failed. The order has not completed and needs reconciliation.",
    RETRY_REQUIRED: `${subject} has an uncertain result and needs another attempt or reconciliation.`,
    ORDER_COMPLETED: "All order operations finished, including inventory finalization.",
    COMPENSATION_DISPATCHED: "An operation to undo completed work was queued.",
    COMPENSATION_SUCCEEDED: `${subject} finished undoing previously completed work.`,
    COMPENSATION_RETRY_REQUIRED: "An undo operation has not succeeded and needs another attempt.",
    COMPENSATION_COMPLETED: "Required undo operations finished. The order is failed, not completed.",
    RECOVERY_CLAIMED: "A recovery worker started checking this unfinished order.",
    DELIVERY_WAIT: "Waiting for command delivery or a response; this is not proof of failure.",
    RECOVERY_RESUMED: "Recovery scheduled another attempt to continue processing.",
    MANUAL_INTERVENTION_REQUIRED: "Automatic processing paused. An operator needs to investigate.",
  };
  return explanations[event.event ?? ""] ?? event.summary;
}
