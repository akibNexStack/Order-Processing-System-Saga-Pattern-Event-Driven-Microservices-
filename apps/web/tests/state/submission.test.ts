import { test } from "node:test";
import assert from "node:assert/strict";
import { createCheckoutStore } from "../../src/stores/checkout-store";
import {
  submitCheckout,
  retryDeadline,
} from "../../src/lib/checkout/submission";
import { payload, orderReply, orderId } from "../fixtures/checkout";
import type { CreateOrderRequest } from "@saga/shared/contracts";

const ready = () => {
  const store = createCheckoutStore(() => crypto.randomUUID());
  store.getState().updateDraft(payload);
  return store;
};
const reply = (request: CreateOrderRequest, status = 202) => ({
  body: orderReply(request, status),
  status,
  retryAfter: null,
  location: null,
});

test("submission locks synchronously and a double click sends only once", async () => {
  const store = ready();
  let resolve!: (value: ReturnType<typeof reply>) => void;
  let original!: CreateOrderRequest;
  let calls = 0;
  const ids: string[] = [];
  const send = (request: CreateOrderRequest) => {
    calls++;
    original = request;
    return new Promise<ReturnType<typeof reply>>((r) => {
      resolve = r;
    });
  };
  const pending = submitCheckout(store, send, (id) => ids.push(id));
  assert.equal(store.getState().submission, "submitting");
  assert.equal(store.getState().updateDraft({ amountMinor: 100 }), false);
  assert.equal(store.getState().resetCheckout(), false);
  assert.equal(await submitCheckout(store, send, () => {}), null);
  assert.equal(calls, 1);
  resolve(reply(original));
  await pending;
  assert.deepEqual(ids, [orderId]);
  assert.equal(store.getState().submission, "settled");
});

test("network, timeout, unavailable and malformed replies keep the exact retry snapshot", async () => {
  for (const status of [
    "FETCH_ERROR",
    "TIMEOUT_ERROR",
    "PARSING_ERROR",
    "INVALID_RESPONSE",
    503,
    504,
    500,
    422,
  ]) {
    const store = ready();
    let original!: CreateOrderRequest;
    await submitCheckout(
      store,
      async (request) => {
        original = request;
        throw { status };
      },
      () => assert.fail(),
    );
    assert.equal(store.getState().submission, "uncertain");
    assert.equal(store.getState().setAmountInput("10"), false);
    assert.equal(store.getState().resetCheckout(), false);
    await submitCheckout(
      store,
      async (request) => {
        assert.deepEqual(request, original);
        return reply(request);
      },
      () => {},
      true,
    );
    assert.equal(store.getState().submission, "settled");
  }
});

test("202, 201, 200 and structured 422 save the order ID with truthful feedback", async () => {
  for (const status of [202, 201, 200, 422]) {
    const store = ready();
    const ids: string[] = [];
    const result = await submitCheckout(
      store,
      async (request) => reply(request, status),
      (id) => ids.push(id),
    );
    assert.equal(result?.status, status);
    assert.deepEqual(ids, [orderId]);
    assert.match(
      result!.message,
      status === 202
        ? /not complete/
        : status === 422
          ? /saga failed/
          : /completed successfully/,
    );
    const oldKey = store.getState().idempotencyKey;
    assert.equal(store.getState().resetCheckout(), true);
    store.getState().updateDraft(payload);
    assert.notEqual(store.getState().beginSubmission()?.idempotencyKey, oldKey);
  }
});

test("409 and contract rejection do not retry or save invented order IDs", async () => {
  for (const status of [409, 400]) {
    const store = ready();
    await submitCheckout(
      store,
      async () => {
        throw { status, body: { error: "Rejected" } };
      },
      () => assert.fail(),
    );
    assert.equal(store.getState().submission, "settled");
    assert.equal(store.getState().receipt?.status, status);
    assert.equal(store.getState().retrySubmission(), null);
  }
});

test("uncorrelated responses or inconsistent status never settle or record another order", async () => {
  for (const mutate of [
    (r: ReturnType<typeof reply>) => {
      r.body.order.idempotencyKey = "different";
    },
    (r: ReturnType<typeof reply>) => {
      r.body.saga.orderId = payload.customerId;
    },
    (r: ReturnType<typeof reply>) => {
      r.body.order.amountMinor = 999;
    },
    (r: ReturnType<typeof reply>) => {
      r.body.items[0].quantity = 999;
    },
    (r: ReturnType<typeof reply>) => {
      r.body.saga.status = "FAILED";
    },
    (r: ReturnType<typeof reply>) => {
      r.status = 422;
    },
  ]) {
    const store = ready();
    await submitCheckout(
      store,
      async (request) => {
        const r = structuredClone(reply(request));
        mutate(r);
        return r;
      },
      () => assert.fail(),
    );
    assert.equal(store.getState().submission, "uncertain");
  }
});

test("Retry-After is honored by the store, including direct retry calls", async () => {
  const now = Date.now();
  assert.equal(retryDeadline("2", now), now + 2000);
  assert.equal(retryDeadline("invalid", now), 0);
  assert.equal(
    retryDeadline(new Date(now + 10000).toUTCString(), now),
    Math.floor((now + 10000) / 1000) * 1000,
  );
  const store = ready();
  await submitCheckout(
    store,
    async () => {
      throw { status: 503, retryAfter: "10" };
    },
    () => {},
  );
  assert.equal(store.getState().retrySubmission(), null);
  assert.ok(store.getState().retryAt > now);
});
