import { test } from "node:test";
import assert from "node:assert/strict";
import { sagaProgress, orderedHistory, explainEvent } from "../../src/lib/orders/progress";
import { orderDetailsFixture } from "../fixtures/orders";
import { orderId } from "../fixtures/checkout";
import type { OrderHistory } from "../../src/lib/api/contracts";

test("forward progress separates shipment success from stock finalization", () => {
  const state = orderDetailsFixture();
  assert.deepEqual(sagaProgress(state).steps.map(s => s.status), ["Running", "Pending", "Pending", "Pending"]);
  state.saga.completedSteps = ["PAYMENT", "INVENTORY", "SHIPPING"];
  state.saga.currentOperation = "FINALIZE_INVENTORY";
  assert.deepEqual(sagaProgress(state).steps.map(s => s.status), ["Succeeded", "Succeeded", "Succeeded", "Running"]);
  state.requiresManualIntervention = true;
  assert.equal(sagaProgress(state).steps[3].status, "Paused");
  state.requiresManualIntervention = false;
  state.saga.inventoryFinalized = true;
  state.saga.status = "COMPLETED";
  assert.ok(sagaProgress(state).steps.every(s => s.status === "Succeeded"));
});

test("compensation uses the reverse cursor, preserving the failed forward operation", () => {
  const state = orderDetailsFixture();
  state.saga.completedSteps = ["PAYMENT", "INVENTORY"];
  state.saga.currentOperation = "CREATE_SHIPMENT";
  state.saga.currentStep = "SHIPPING";
  state.saga.status = "COMPENSATING";
  let result = sagaProgress(state);
  assert.equal(result.steps[2].status, "Failed");
  assert.deepEqual(result.compensation.map(s => s.status), ["Not needed", "Running", "Pending"]);
  state.saga.compensatedSteps = ["INVENTORY"];
  result = sagaProgress(state);
  assert.deepEqual(result.compensation.map(s => s.status), ["Not needed", "Succeeded", "Running"]);
  assert.match(result.steps[1].note, /undone/);
  state.saga.compensatedSteps.push("PAYMENT");
  state.saga.status = "FAILED";
  assert.deepEqual(sagaProgress(state).compensation.map(s => s.status), ["Not needed", "Succeeded", "Succeeded"]);
  assert.equal(sagaProgress(state).steps[2].status, "Failed");
});

test("payment rejection does not invent compensation and unconfirmed steps never succeed", () => {
  const state = orderDetailsFixture();
  state.saga.status = "FAILED";
  assert.deepEqual(sagaProgress(state).steps.map(s => s.status), ["Failed", "Pending", "Pending", "Pending"]);
  assert.deepEqual(sagaProgress(state).compensation, []);
  state.saga.status = "COMPLETED";
  assert.ok(sagaProgress(state).steps.every(s => s.status !== "Succeeded"));
});

test("uncertain results stay unfinished, failures remain visible, and unrelated results are ignored", () => {
  const state = orderDetailsFixture();
  state.saga.lastResult = {
    version: 1, orderId, sagaId: state.saga.id, idempotencyKey: "test",
    operation: "CHARGE_PAYMENT", outcome: "UNKNOWN",
    error: { code: "PROVIDER_TIMEOUT", message: "Timed out", retryable: true },
  };
  assert.equal(sagaProgress(state).steps[0].status, "Running");
  assert.match(sagaProgress(state).steps[0].note, /uncertain/);
  state.saga.lastResult = {
    ...state.saga.lastResult, outcome: "FAILED",
    error: { code: "INVALID_STATE", message: "Reconcile", retryable: false },
  };
  assert.equal(sagaProgress(state).steps[0].status, "Failed");
  state.saga.lastResult.sagaId = orderId;
  assert.equal(sagaProgress(state).steps[0].status, "Running");
});

test("history uses immutable sequence ordering and rejects wrong identities or duplicate sequences", () => {
  const history: OrderHistory = { orderId, status: "IN_PROGRESS", interventionReason: null, history: [
    { sequence: 2, at: "2026-09-09T00:00:00Z", step: "PAYMENT", direction: "FORWARD", from: "IN_PROGRESS", to: "IN_PROGRESS", summary: "Future event", event: "NEW_EVENT" },
    { sequence: 1, at: "2026-09-09T00:00:00Z", step: "PAYMENT", direction: "FORWARD", from: null, to: "IN_PROGRESS", summary: "Accepted", event: "ORDER_ACCEPTED" },
  ] };
  assert.deepEqual(orderedHistory(history, orderId)?.map(e => e.sequence), [1, 2]);
  assert.equal(history.history[0].sequence, 2);
  assert.match(explainEvent(history.history[1]), /accepted/);
  assert.equal(explainEvent(history.history[0]), "Future event");
  assert.equal(orderedHistory(history, "wrong-order"), null);
  history.history.push(history.history[0]);
  assert.equal(orderedHistory(history, orderId), null);
});
