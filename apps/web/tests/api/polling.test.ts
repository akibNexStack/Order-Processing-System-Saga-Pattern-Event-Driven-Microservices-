import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore } from "../../src/lib/store";
import { sagaApi } from "../../src/lib/api/api";
import { cancelOrderReads, pollingDelay } from "../../src/lib/orders/polling";
import { orderDetailsFixture } from "../fixtures/orders";
import { orderId } from "../fixtures/checkout";

test("polling retries initial transport failures, caps backoff, and stops unsafe or terminal reads", () => {
  for (const status of ["FETCH_ERROR", "TIMEOUT_ERROR", 408, 429, 502, 503, 504]) {
    assert.deepEqual([1, 2, 3, 4, 10].map(n => pollingDelay(undefined, { status }, n)),
      [4000, 8000, 16000, 30000, 30000]);
  }
  for (const status of [400, 401, 404, "PARSING_ERROR", "INVALID_RESPONSE"])
    assert.equal(pollingDelay(orderDetailsFixture(), { status }, 1), null);
  const state = orderDetailsFixture();
  assert.equal(pollingDelay(state, undefined, 10), 2000);
  for (const status of ["COMPLETED", "FAILED"] as const) {
    state.saga.status = status;
    assert.equal(pollingDelay(state, undefined, 0), null);
  }
  state.saga.status = "IN_PROGRESS";
  state.requiresManualIntervention = true;
  assert.equal(pollingDelay(state, undefined, 0), null);
});

test("resume invalidation refreshes a paused order and makes it eligible to poll", async t => {
  const NativeRequest = globalThis.Request;
  t.mock.method(globalThis, "Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://fixture.test") : input, init);
    }
  });
  let paused = true;
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    if (request.method === "POST") paused = false;
    else reads++;
    const state = orderDetailsFixture();
    state.requiresManualIntervention = paused;
    return Response.json(state, { status: request.method === "POST" ? 202 : 200 });
  });
  const store = makeStore();
  t.after(() => store.dispatch(sagaApi.util.resetApiState()));
  const subscription = store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId));
  const before = await subscription.unwrap();
  assert.equal(pollingDelay(before.body, undefined, 0), null);
  await store.dispatch(sagaApi.endpoints.resumeOrder.initiate(orderId)).unwrap();
  await Promise.all(store.dispatch(sagaApi.util.getRunningQueriesThunk()));
  const after = sagaApi.endpoints.getOrder.select(orderId)(store.getState());
  assert.equal(reads, 2);
  assert.equal(pollingDelay(after.data?.body, after.error, 0), 2000);
  subscription.unsubscribe();
});

test("an older GET cannot roll back the newer resume snapshot", async t => {
  const NativeRequest = globalThis.Request;
  t.mock.method(globalThis, "Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://fixture.test") : input, init);
    }
  });
  let reads = 0;
  let release!: (response: Response) => void;
  const stale = new Promise<Response>(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const body = orderDetailsFixture();
    if (request.method === "POST") {
      body.saga.status = "COMPLETED";
      body.saga.version = 3;
      return Response.json(body);
    }
    if (++reads === 2) return stale;
    return Response.json(body);
  });
  const store = makeStore();
  t.after(() => store.dispatch(sagaApi.util.resetApiState()));
  await store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId));
  const pending = store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId, { forceRefetch: true }));
  await new Promise(resolve => setImmediate(resolve));
  await store.dispatch(sagaApi.endpoints.resumeOrder.initiate(orderId)).unwrap();
  release(Response.json(orderDetailsFixture()));
  await pending;
  await Promise.all(store.dispatch(sagaApi.util.getRunningQueriesThunk()));
  const result = sagaApi.endpoints.getOrder.select(orderId)(store.getState());
  assert.equal(result.data?.body.saga.version, 3);
  assert.equal(result.data?.body.saga.status, "COMPLETED");
});

test("detail cleanup aborts all reads, duplicate GETs share a request, and late replies cannot overwrite newer data", async t => {
  const NativeRequest = globalThis.Request;
  t.mock.method(globalThis, "Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://fixture.test") : input, init);
    }
  });
  const pending: { request: Request; resolve: (response: Response) => void }[] = [];
  t.mock.method(globalThis, "fetch", (request: Request) => new Promise<Response>(resolve => {
    pending.push({ request, resolve });
  }));
  const store = makeStore();
  t.after(() => store.dispatch(sagaApi.util.resetApiState()));
  const requests = [
    store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId)),
    store.dispatch(sagaApi.endpoints.getOrderHistory.initiate(orderId)),
    store.dispatch(sagaApi.endpoints.getPayment.initiate(orderId)),
    store.dispatch(sagaApi.endpoints.getReservation.initiate(orderId)),
    store.dispatch(sagaApi.endpoints.getShipment.initiate(orderId)),
  ];
  const duplicate = store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId, { forceRefetch: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 5);
  cancelOrderReads(store.dispatch, orderId);
  await Promise.all([...requests, duplicate]);
  assert.ok(pending.every(item => item.request.signal.aborted));
  const latest = store.dispatch(sagaApi.endpoints.getOrder.initiate(orderId, { forceRefetch: true }));
  await new Promise(resolve => setImmediate(resolve));
  const completed = orderDetailsFixture();
  completed.saga.status = "COMPLETED";
  pending[5].resolve(Response.json(completed));
  await latest;
  // Simulate a transport that still completes despite cancellation.
  for (const item of pending.slice(0, 5)) item.resolve(Response.json(orderDetailsFixture()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sagaApi.endpoints.getOrder.select(orderId)(store.getState()).data?.body.saga.status, "COMPLETED");
});
