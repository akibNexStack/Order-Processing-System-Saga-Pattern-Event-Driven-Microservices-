import {
  BrowserCreateOrderRequestSchema,
  BrowserOrderPayloadSchema,
  type OrderPayload,
} from "@saga/shared/contracts";
// Do not import the shared package root in browser code: it also exposes
// server-only idempotency utilities that depend on node:crypto.
import { calculateOrderTotal, catalog } from "@saga/shared/catalog";

export const products = catalog;
export function calculateCheckoutTotal(items: OrderPayload["items"]): number | null {
  try { return calculateOrderTotal(items); } catch { return null; }
}

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
type Draft = Omit<OrderPayload, "customerId" | "amountMinor" | "paymentMethod"> & { customerId?: string; amountMinor: number | null; paymentMethod?: OrderPayload["paymentMethod"] };
function normalizeDraft(draft: Draft) {
  const { customerId: _customerId, ...publicDraft } = draft;
  const address = { ...draft.shippingAddress };
  if (!address.line2?.trim()) delete address.line2;
  if (!address.region?.trim()) delete address.region;
  address.countryCode = address.countryCode.trim().toUpperCase();
  return {
    ...publicDraft,
    paymentMethod: draft.paymentMethod ?? "COD",
    shippingAddress: address,
  };
}
export function validateCheckoutDraft(draft: Draft) {
  const parsed = BrowserOrderPayloadSchema.safeParse(normalizeDraft(draft));
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors[path] ??=
        path === "amountMinor"
          ? "Select an available product with a valid quantity."
          : issue.message;
    }
  return { parsed, errors };
}
// Step 7 supplies a real key; validation alone does not generate or consume one.
export function buildCreateOrderRequest(draft: Draft, idempotencyKey: string) {
  return BrowserCreateOrderRequestSchema.safeParse({
    idempotencyKey,
    payload: (() => {
      return normalizeDraft(draft);
    })(),
  });
}
