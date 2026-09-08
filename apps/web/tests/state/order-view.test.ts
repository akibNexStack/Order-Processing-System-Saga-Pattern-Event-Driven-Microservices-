import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesOrder,
  matchesRecords,
  isMissing,
} from "../../src/lib/orders/view";
import { orderDetailsFixture, participantFixtures } from "../fixtures/orders";
import { orderId, payload } from "../fixtures/checkout";

test("order identity checks reject another order, saga, or item before display", () => {
  assert.ok(matchesOrder(orderDetailsFixture(), orderId.toUpperCase()));
  for (const field of ["order", "saga", "item"]) {
    const state = orderDetailsFixture();
    if (field === "order") state.order.id = payload.customerId;
    if (field === "saga") state.saga.orderId = payload.customerId;
    if (field === "item") state.items[0].orderId = payload.customerId;
    assert.equal(matchesOrder(state, orderId), false);
  }
});
test("participant records must match both order and saga, including compensation-only rows", () => {
  const record = participantFixtures().Payment.payment;
  assert.ok(matchesRecords([null, record], orderId, record.sagaId));
  assert.equal(
    matchesRecords([record], payload.customerId, record.sagaId),
    false,
  );
  assert.equal(matchesRecords([record], orderId, payload.customerId), false);
});
test("only the documented missing-record response means not started", () => {
  for (const name of ["Order", "Payment", "Reservation", "Shipment"]) {
    assert.ok(
      isMissing({ status: 404, body: { error: `${name} not found` } }, name),
    );
    assert.equal(
      isMissing({ status: 503, body: { error: `${name} not found` } }, name),
      false,
    );
    assert.equal(
      isMissing({ status: 404, body: { error: "Unknown path" } }, name),
      false,
    );
    assert.equal(
      isMissing({ status: "PARSING_ERROR", httpStatus: 404 }, name),
      false,
    );
    assert.equal(isMissing(undefined, name), false);
  }
});
