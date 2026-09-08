import {
  CreateOrderRequestSchema,
  OrderPayloadSchema,
  type OrderPayload,
} from "@saga/shared/contracts";

export const demoProducts = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    sku: "DEMO-KEYBOARD",
    name: "Demo Keyboard",
    initialStock: 100,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    sku: "DEMO-MOUSE",
    name: "Demo Mouse",
    initialStock: 50,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    sku: "DEMO-MONITOR",
    name: "Demo Monitor",
    initialStock: 0,
  },
] as const;

// Decimal-string arithmetic: never multiply a floating-point currency amount.
export function parseAmountMinor(input: string): number | null {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const minor =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor >= 1 && minor <= 9_999_999_999 ? minor : null;
}
export function formatMinor(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
type Draft = Omit<OrderPayload, "amountMinor"> & { amountMinor: number | null };
function normalizeDraft(draft: Draft) {
  const address = { ...draft.shippingAddress };
  if (!address.line2?.trim()) delete address.line2;
  if (!address.region?.trim()) delete address.region;
  address.countryCode = address.countryCode.trim().toUpperCase();
  return {
    ...draft,
    customerId: draft.customerId.trim().toLowerCase(),
    shippingAddress: address,
  };
}
export function validateCheckoutDraft(draft: Draft) {
  const parsed = OrderPayloadSchema.safeParse(normalizeDraft(draft));
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors[path] ??=
        path === "amountMinor"
          ? "Enter 0.01–99,999,999.99 with at most two decimal places; no commas or exponents."
          : issue.message;
    }
  return { parsed, errors };
}
// Step 7 supplies a real key; validation alone does not generate or consume one.
export function buildCreateOrderRequest(draft: Draft, idempotencyKey: string) {
  return CreateOrderRequestSchema.safeParse({
    idempotencyKey,
    payload: normalizeDraft(draft),
  });
}
