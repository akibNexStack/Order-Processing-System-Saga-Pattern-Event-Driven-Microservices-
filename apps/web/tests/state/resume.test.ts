import { test } from "node:test";
import assert from "node:assert/strict";
import { validResumeReply, resumeMessage } from "../../src/lib/orders/resume";
import { AttentionSchema } from "../../src/lib/api/contracts";
import { orderDetailsFixture } from "../fixtures/orders";
import { orderId } from "../fixtures/checkout";

test("resume accepts only correlated order snapshots with matching HTTP outcomes", () => {
  for (const [status, sagaStatus] of [[200, "COMPLETED"], [202, "IN_PROGRESS"], [202, "COMPENSATING"], [422, "FAILED"]] as const) {
    const body = orderDetailsFixture();
    body.saga.status = sagaStatus;
    const reply = { body, status, retryAfter: null, location: null };
    assert.ok(validResumeReply(reply, orderId));
    assert.equal(validResumeReply({ ...reply, status: 201 }, orderId), false);
    assert.equal(validResumeReply(reply, "another-id"), false);
    assert.equal(validResumeReply({ ...reply, status: status === 202 ? 200 : 202 }, orderId), false);
    assert.ok(resumeMessage(reply).length > 0);
    body.items[0].orderId = "another-id";
    assert.equal(validResumeReply(reply, orderId), false);
  }
});

test("attention enforces the backend cap and rejects duplicate or excessive records", () => {
  const row = { orderId, sagaId: orderDetailsFixture().saga.id, status: "IN_PROGRESS",
    operation: "CHARGE_PAYMENT", reason: null, updatedAt: "2026-09-09T06:00:00Z" };
  assert.ok(AttentionSchema.safeParse({ limit: 100, orders: [row] }).success);
  assert.equal(AttentionSchema.safeParse({ limit: 101, orders: [] }).success, false);
  assert.equal(AttentionSchema.safeParse({ limit: 100, orders: [row, row] }).success, false);
  assert.equal(AttentionSchema.safeParse({ limit: 1, orders: [row, { ...row, orderId: row.sagaId }] }).success, false);
});
