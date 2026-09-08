import { test } from "node:test";
import assert from "node:assert/strict";
import type { BaseQueryApi } from "@reduxjs/toolkit/query";
import { z } from "zod";
import { createBaseQuery } from "../../src/lib/api/base-query";
import { OrderStateSchema } from "../../src/lib/api/contracts";
import { ReadinessSchema } from "../../src/lib/api/contracts";

const context = (signal = new AbortController().signal): BaseQueryApi => ({
  signal,
  abort() {},
  dispatch: () => undefined,
  getState: () => ({}),
  extra: undefined,
  endpoint: "test",
  type: "query",
});

test("client validates response shape, preserves error metadata and handles malformed JSON", async (t) => {
  const query = createBaseQuery("http://api.test/");
  for (const [response, expected] of [
    [Response.json({ wrong: true }), "INVALID_RESPONSE"],
    [
      new Response("not json", {
        headers: { "Content-Type": "application/json" },
      }),
      "PARSING_ERROR",
    ],
    [
      Response.json(
        { error: "Conflict" },
        { status: 409, headers: { "Retry-After": "3" } },
      ),
      409,
    ],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const result = await query(
      { url: "orders", schema: z.object({ ok: z.boolean() }) },
      context(),
      {},
    );
    assert.equal(result.error?.status, expected);
    assert.equal(result.error?.httpStatus, response.status);
    if (expected === 409) {
      assert.equal(result.error?.retryAfter, "3");
      assert.deepEqual(result.error?.body, { error: "Conflict" });
    }
    mock.mock.restore();
  }
});

test("client network errors and deadlines never automatically retry a mutation", async (t) => {
  const query = createBaseQuery("http://api.test/", 10);
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (request: Request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        );
      }),
  );
  const result = await query(
    {
      url: "orders",
      method: "POST",
      body: { idempotencyKey: "keep-me" },
      schema: z.unknown(),
    },
    { ...context(), type: "mutation" },
    {},
  );
  assert.equal(result.error?.status, "TIMEOUT_ERROR");
  assert.equal(mock.mock.callCount(), 1);
  mock.mock.restore();
  const unavailable = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Network unavailable");
  });
  assert.equal(
    (await query({ url: "orders", schema: z.unknown() }, context(), {})).error
      ?.status,
    "FETCH_ERROR",
  );
  assert.equal(unavailable.mock.callCount(), 1);
});

test("readiness distinguishes an unhealthy service from an unreachable service", async t => {
  const query = createBaseQuery("http://api.test/");
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Backend unavailable", code: "BACKEND_UNAVAILABLE" }, { status: 503 }));
  const result = await query({ url: "ready", schema: ReadinessSchema, statuses: [200, 503] }, context(), {});
  assert.equal(result.error?.status, 503);
  assert.deepEqual(result.error?.body, { error: "Backend unavailable", code: "BACKEND_UNAVAILABLE" });
  mock.mock.restore();
});

test("order DTO accepts the actual saga row shape without an invented sagaId field", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const time = "2026-09-08T06:00:00.000Z";
  const payload = {
    customerId: id,
    items: [{ productId: id, quantity: 1 }],
    amountMinor: 100,
    currency: "USD",
    shippingAddress: {
      recipient: "Test",
      line1: "Test road",
      city: "Dhaka",
      postalCode: "1200",
      countryCode: "BD",
    },
  };
  const state = {
    order: { id, ...payload, idempotencyKey: "key", createdAt: time },
    saga: {
      id,
      orderId: id,
      createdAt: time,
      updatedAt: time,
      status: "IN_PROGRESS",
      currentStep: "PAYMENT",
      currentOperation: "CHARGE_PAYMENT",
      completedSteps: [],
      compensatedSteps: [],
      inventoryFinalized: false,
      lastResult: null,
      payload,
      version: 0,
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
    items: [{ orderId: id, productId: id, quantity: 1 }],
    transitions: [],
    requiresCompensation: false,
    requiresManualIntervention: false,
  };
  assert.ok(OrderStateSchema.safeParse(state).success);
  assert.ok(
    OrderStateSchema.safeParse({
      ...state,
      saga: { ...state.saga, status: "FAILED" },
    }).success,
  );
  assert.equal(
    OrderStateSchema.safeParse({ ...state, saga: {} }).success,
    false,
  );
});
