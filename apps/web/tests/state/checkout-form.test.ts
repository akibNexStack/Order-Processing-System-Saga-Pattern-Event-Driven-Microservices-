import { test } from "node:test";
import assert from "node:assert/strict";
import { inventorySeed } from "../../../../services/inventory-service/src/db/seed";
import { CreateOrderRequestSchema } from "@saga/shared/contracts";
import {
  buildCreateOrderRequest,
  demoProducts,
  formatMinor,
  parseAmountMinor,
  validateCheckoutDraft,
} from "../../src/lib/checkout/form";
import {
  createCheckoutStore,
  type CheckoutDraft,
} from "../../src/stores/checkout-store";

const validDraft = (): CheckoutDraft => ({
  customerId: "11111111-1111-4111-8111-111111111111",
  items: [{ productId: demoProducts[0].id, quantity: 2 }],
  amountMinor: 29,
  currency: "BDT",
  shippingAddress: {
    recipient: " Demo User ",
    line1: " Test Road ",
    line2: "  ",
    city: "Dhaka",
    region: "",
    postalCode: "1200",
    countryCode: "bd",
  },
});

test("demo catalog matches the actual inventory seed without claiming live stock", () => {
  assert.deepEqual(
    demoProducts.map(({ initialStock, ...product }) => ({
      ...product,
      availableStock: initialStock,
    })),
    inventorySeed,
  );
});
test("money conversion is exact for cents and boundary values", () => {
  for (const [input, expected] of [
    ["0.01", 1],
    ["0.29", 29],
    ["1.1", 110],
    ["19.99", 1999],
    [" 12.30 ", 1230],
    ["99999999.99", 9999999999],
  ] as const)
    assert.equal(parseAmountMinor(input), expected, input);
  for (const minor of [1, 29, 100, 1999, 123456789, 9999999999])
    assert.equal(parseAmountMinor(formatMinor(minor)), minor);
});
test("invalid/ambiguous money syntax is rejected instead of rounded or partially parsed", () => {
  for (const input of [
    "",
    " ",
    "0",
    "0.00",
    "-1",
    "+1",
    "1e2",
    "1,000",
    "1.001",
    "1.",
    ".50",
    "100000000",
    "Infinity",
    "NaN",
    "12abc",
    "1 2",
  ])
    assert.equal(parseAmountMinor(input), null, input);
});
test("validation normalizes optional address fields and produces a shared-contract request", () => {
  const draft = validDraft();
  const result = buildCreateOrderRequest(draft, "test-key");
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.ok(CreateOrderRequestSchema.safeParse(result.data).success);
  assert.equal(result.data.payload.shippingAddress.recipient, "Demo User");
  assert.equal(result.data.payload.shippingAddress.countryCode, "BD");
  assert.equal(result.data.payload.shippingAddress.line2, undefined);
  assert.equal(result.data.payload.shippingAddress.region, undefined);
  assert.equal(draft.shippingAddress.countryCode, "bd", "input is not mutated");
  assert.equal(buildCreateOrderRequest(draft, "invalid key").success, false);
});
test("shared validation reports field-level errors and rejects invalid quantities and duplicate products", () => {
  for (const quantity of [0, -1, 1.5, 10001, NaN]) {
    const draft = validDraft();
    draft.items[0].quantity = quantity;
    assert.ok(validateCheckoutDraft(draft).errors["items.0.quantity"]);
  }
  const draft = validDraft();
  draft.items.push({ ...draft.items[0] });
  assert.ok(validateCheckoutDraft(draft).errors.items);
  draft.customerId = "bad";
  draft.shippingAddress.postalCode = " ";
  draft.shippingAddress.countryCode = "ZZZ";
  const { errors } = validateCheckoutDraft(draft);
  assert.ok(errors.customerId);
  assert.ok(errors["shippingAddress.postalCode"]);
  assert.ok(errors["shippingAddress.countryCode"]);
});
test("amount input is memory-only, stays synchronized, and obeys checkout locks/reset", () => {
  const store = createCheckoutStore(() => "real-test-key");
  store.getState().updateDraft(validDraft());
  assert.equal(store.getState().amountInput, "0.29");
  store.getState().setAmountInput("1.001");
  assert.equal(store.getState().amountInput, "1.001");
  assert.equal(store.getState().draft.amountMinor, null);
  assert.equal(store.getState().beginSubmission(), null);
  store.getState().setAmountInput("12.30");
  const request = store.getState().beginSubmission()!;
  assert.equal(request.payload.amountMinor, 1230);
  assert.equal(request.payload.shippingAddress.line2, undefined);
  assert.equal(store.getState().setAmountInput("2.00"), false);
  store.getState().markSettled(request.idempotencyKey);
  store.getState().resetCheckout();
  assert.equal(store.getState().amountInput, "");
  assert.equal(store.getState().draft.amountMinor, null);
});
