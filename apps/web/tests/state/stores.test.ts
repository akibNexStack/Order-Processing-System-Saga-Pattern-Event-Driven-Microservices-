import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCheckoutStore,
  type CheckoutDraft,
} from "../../src/stores/checkout-store";
import {
  createUiStore,
  connectUiPersistence,
  UI_STORAGE_KEY,
} from "../../src/stores/ui-store";

const id = (n = 1) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const draft = (): CheckoutDraft => ({
  customerId: id(),
  items: [{ productId: id(2), quantity: 1 }],
  amountMinor: 100,
  currency: "BDT",
  shippingAddress: {
    recipient: "Private recipient",
    line1: "Private street",
    city: "Dhaka",
    postalCode: "1200",
    countryCode: "BD",
  },
});
function memoryStorage(initial: string | null = null) {
  let value = initial;
  let writes = 0;
  return {
    getItem: (key: string) => {
      assert.equal(key, UI_STORAGE_KEY);
      return value;
    },
    setItem: (key: string, next: string) => {
      assert.equal(key, UI_STORAGE_KEY);
      value = next;
      writes++;
    },
    value: () => value,
    writes: () => writes,
  };
}

test("checkout stores are isolated and draft edits clone their inputs", () => {
  const first = createCheckoutStore();
  const second = createCheckoutStore();
  const input = draft();
  assert.equal(first.getState().updateDraft(input), true);
  input.items[0].quantity = 5;
  input.shippingAddress.line1 = "Changed";
  assert.equal(first.getState().draft.items[0].quantity, 1);
  assert.equal(first.getState().draft.shippingAddress.line1, "Private street");
  assert.equal(second.getState().draft.customerId, "");
  assert.equal(first.getState().idempotencyKey, null);
});

test("invalid drafts and invalid/failed key generation cannot begin submission", () => {
  const store = createCheckoutStore(() => "valid-key");
  assert.equal(store.getState().beginSubmission(), null);
  assert.equal(store.getState().submission, "idle");
  assert.ok(store.getState().error);
  assert.equal(store.getState().idempotencyKey, null);
  for (const factory of [
    () => "invalid key",
    () => {
      throw new Error("No crypto");
    },
  ]) {
    const invalid = createCheckoutStore(factory);
    invalid.getState().updateDraft(draft());
    assert.equal(invalid.getState().beginSubmission(), null);
    assert.ok(invalid.getState().error);
  }
});

test("submission locks edits and duplicate requests and protects its snapshot", () => {
  const store = createCheckoutStore(() => "original-key");
  store.getState().updateDraft(draft());
  const request = store.getState().beginSubmission()!;
  assert.equal(request.idempotencyKey, "original-key");
  assert.equal(store.getState().submission, "submitting");
  assert.equal(store.getState().beginSubmission(), null);
  assert.equal(store.getState().retrySubmission(), null);
  assert.equal(store.getState().updateDraft({ amountMinor: 200 }), false);
  assert.equal(store.getState().resetCheckout(), false);
  request.payload.items[0].quantity = 99;
  assert.equal(store.getState().request!.payload.items[0].quantity, 1);
  assert.ok(Object.isFrozen(store.getState().request!.payload.shippingAddress));
});

test("uncertain retries keep the exact payload and key, ignoring stale callbacks", () => {
  let generated = 0;
  const store = createCheckoutStore(() => `key-${++generated}`);
  store.getState().updateDraft(draft());
  const original = store.getState().beginSubmission()!;
  assert.equal(store.getState().markUncertain("stale-key", "Timeout"), false);
  assert.equal(store.getState().markSettled("stale-key"), false);
  assert.equal(
    store.getState().markUncertain(original.idempotencyKey, "Timeout"),
    true,
  );
  assert.equal(store.getState().updateDraft({ items: [] }), false);
  assert.equal(store.getState().resetCheckout(), false);
  assert.deepEqual(store.getState().retrySubmission(), original);
  assert.equal(generated, 1);
  assert.equal(store.getState().error, null);
});

test("settled submissions reset all private draft state and the next checkout uses a new key", () => {
  let generated = 0;
  const store = createCheckoutStore(() => `key-${++generated}`);
  store.getState().updateDraft(draft());
  const original = store.getState().beginSubmission()!;
  store.getState().markUncertain(original.idempotencyKey, "Timeout");
  assert.equal(store.getState().markSettled(original.idempotencyKey), true);
  assert.equal(store.getState().retrySubmission(), null);
  assert.equal(store.getState().resetCheckout(), true);
  assert.equal(store.getState().request, null);
  assert.equal(store.getState().idempotencyKey, null);
  assert.equal(store.getState().draft.shippingAddress.line1, "");
  store.getState().updateDraft(draft());
  assert.notEqual(
    store.getState().beginSubmission()!.idempotencyKey,
    original.idempotencyKey,
  );
});

test("persistence does not access storage before explicit hydration", () => {
  const store = createUiStore();
  assert.equal(store.getState().hydration, "pending");
  assert.equal(store.getState().addRecentOrder(id()), false);
  assert.equal(store.getState().clearRecentOrders(), false);
  assert.equal(store.getState().removeRecentOrder(id()), false);
  assert.equal(store.getState().setRememberRecentOrders(false), false);
  store.getState().setMenuOpen(true);
  assert.equal(store.getState().menuOpen, true);
});

test("recent IDs are canonical, deduplicated, most-recent-first and capped at 20", () => {
  const store = createUiStore();
  const storage = memoryStorage();
  const stop = connectUiPersistence(store, () => storage);
  for (let n = 1; n <= 25; n++)
    assert.equal(store.getState().addRecentOrder(id(n)), true);
  assert.equal(store.getState().recentOrderIds.length, 20);
  store.getState().addRecentOrder(id(20).toUpperCase());
  assert.equal(store.getState().recentOrderIds[0], id(20));
  assert.equal(store.getState().recentOrderIds.length, 20);
  assert.equal(store.getState().addRecentOrder("invalid"), false);
  store.getState().removeRecentOrder(id(20).toUpperCase());
  assert.ok(!store.getState().recentOrderIds.includes(id(20)));
  store.getState().clearRecentOrders();
  assert.deepEqual(store.getState().recentOrderIds, []);
  stop();
});

test("reload restores only preferences/IDs, never drawer state or injected private data", () => {
  const storage = memoryStorage(
    JSON.stringify({
      version: 1,
      state: {
        recentOrderIds: [id().toUpperCase(), "invalid", id(), id(2)],
        rememberRecentOrders: true,
        menuOpen: true,
        draft: draft(),
        hydration: "ready",
        addRecentOrder: "corrupt",
      },
    }),
  );
  const store = createUiStore();
  const stop = connectUiPersistence(store, () => storage);
  assert.deepEqual(store.getState().recentOrderIds, [id(), id(2)]);
  assert.equal(store.getState().menuOpen, false);
  assert.equal(typeof store.getState().addRecentOrder, "function");
  assert.deepEqual(Object.keys(JSON.parse(storage.value()!).state).sort(), [
    "recentOrderIds",
    "rememberRecentOrders",
  ]);
  assert.doesNotMatch(
    storage.value()!,
    /Private|draft|menuOpen|idempotencyKey/,
  );
  store.getState().setMenuOpen(true);
  const writes = storage.writes();
  store.getState().setMenuOpen(false);
  assert.equal(storage.writes(), writes);
  stop();
  const reloaded = createUiStore();
  const cleanup = connectUiPersistence(reloaded, () => storage);
  assert.deepEqual(reloaded.getState().recentOrderIds, [id(), id(2)]);
  cleanup();
});

test("opting out clears stored history and prevents new IDs until opted in", () => {
  const storage = memoryStorage();
  const store = createUiStore();
  const stop = connectUiPersistence(store, () => storage);
  store.getState().addRecentOrder(id());
  store.getState().setRememberRecentOrders(false);
  assert.equal(store.getState().addRecentOrder(id(2)), false);
  assert.deepEqual(JSON.parse(storage.value()!).state, {
    recentOrderIds: [],
    rememberRecentOrders: false,
  });
  store.getState().setRememberRecentOrders(true);
  assert.equal(store.getState().addRecentOrder(id()), true);
  stop();
});

test("corrupt JSON, null, incompatible versions and invalid fields recover safely", () => {
  for (const initial of [
    "not-json",
    "null",
    JSON.stringify({ version: 9, state: { recentOrderIds: [id()] } }),
    JSON.stringify({ version: 1, state: { recentOrderIds: 100 } }),
  ]) {
    const store = createUiStore();
    const storage = memoryStorage(initial);
    const stop = connectUiPersistence(store, () => storage);
    assert.equal(store.getState().hydration, "ready");
    assert.deepEqual(store.getState().recentOrderIds, []);
    stop();
  }
});

test("unavailable/blocked storage keeps navigation and in-memory history usable", () => {
  for (const getStorage of [
    () => {
      throw new Error("SecurityError");
    },
    () => ({
      getItem() {
        throw new Error("Read failed");
      },
      setItem() {},
    }),
    () => ({
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    }),
  ]) {
    const store = createUiStore();
    const stop = connectUiPersistence(store, getStorage);
    assert.equal(store.getState().hydration, "unavailable");
    store.getState().setMenuOpen(true);
    assert.equal(store.getState().menuOpen, true);
    assert.equal(store.getState().addRecentOrder(id()), true);
    stop();
  }
});

test("Strict Mode reconnection and cleanup do not lose state or duplicate subscriptions", () => {
  const store = createUiStore();
  const storage = memoryStorage();
  const stop = connectUiPersistence(store, () => storage);
  store.getState().addRecentOrder(id());
  stop();
  const before = storage.writes();
  store.getState().addRecentOrder(id(2));
  assert.equal(storage.writes(), before);
  const stopAgain = connectUiPersistence(store, () => storage);
  assert.deepEqual(store.getState().recentOrderIds, [id(2), id()]);
  const after = storage.writes();
  store.getState().addRecentOrder(id(3));
  assert.equal(storage.writes(), after + 1);
  stopAgain();
});
