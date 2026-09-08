import { createStore } from "zustand/vanilla";
import {
  parseAmountMinor,
  formatMinor,
  buildCreateOrderRequest,
} from "../lib/checkout/form";
import {
  type CreateOrderRequest,
  type OrderPayload,
} from "@saga/shared/contracts";

export type CheckoutDraft = Omit<OrderPayload, "amountMinor"> & {
  amountMinor: number | null;
};
export type SubmissionPhase = "idle" | "submitting" | "uncertain" | "settled";
export interface CheckoutState {
  draft: CheckoutDraft;
  amountInput: string;
  setAmountInput: (input: string) => boolean;
  idempotencyKey: string | null;
  submission: SubmissionPhase;
  request: CreateOrderRequest | null;
  error: string | null;
  updateDraft: (patch: Partial<CheckoutDraft>) => boolean;
  beginSubmission: () => CreateOrderRequest | null;
  retrySubmission: () => CreateOrderRequest | null;
  markUncertain: (key: string, message: string) => boolean;
  markSettled: (key: string) => boolean;
  resetCheckout: () => boolean;
}

const emptyDraft = (): CheckoutDraft => ({
  customerId: "",
  items: [],
  amountMinor: null,
  currency: "BDT",
  shippingAddress: {
    recipient: "",
    line1: "",
    city: "",
    postalCode: "",
    countryCode: "BD",
  },
});

// Freeze the retry snapshot, including nested items/address. Callers receive copies.
function freezeRequest(request: CreateOrderRequest): CreateOrderRequest {
  request.payload.items.forEach(Object.freeze);
  Object.freeze(request.payload.items);
  Object.freeze(request.payload.shippingAddress);
  Object.freeze(request.payload);
  return Object.freeze(request);
}

// No persistence, module singleton, server data, or network side effects.
export function createCheckoutStore(
  makeKey: () => string = () => crypto.randomUUID(),
) {
  return createStore<CheckoutState>()((set, get) => ({
    draft: emptyDraft(),
    amountInput: "",
    idempotencyKey: null,
    submission: "idle",
    request: null,
    error: null,
    setAmountInput(amountInput) {
      if (get().submission !== "idle") return false;
      set({
        amountInput,
        draft: { ...get().draft, amountMinor: parseAmountMinor(amountInput) },
        error: null,
      });
      return true;
    },
    updateDraft(patch) {
      if (get().submission !== "idle") return false;
      set({
        draft: structuredClone({ ...get().draft, ...patch }),
        ...(Object.hasOwn(patch, "amountMinor")
          ? {
              amountInput:
                patch.amountMinor == null ? "" : formatMinor(patch.amountMinor),
            }
          : {}),
        error: null,
      });
      return true;
    },
    beginSubmission() {
      if (get().submission !== "idle") return null;
      let key: string;
      try {
        key = makeKey();
      } catch {
        set({
          error:
            "Unable to generate a secure idempotency key. Use HTTPS or localhost.",
        });
        return null;
      }
      const parsed = buildCreateOrderRequest(get().draft, key);
      if (!parsed.success) {
        set({
          error: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
        return null;
      }
      const request = freezeRequest(parsed.data);
      set({
        request,
        idempotencyKey: key,
        submission: "submitting",
        error: null,
      });
      return structuredClone(request);
    },
    retrySubmission() {
      const { submission, request } = get();
      if (submission !== "uncertain" || !request) return null;
      set({ submission: "submitting", error: null });
      return structuredClone(request);
    },
    markUncertain(key, message) {
      if (get().idempotencyKey !== key || get().submission !== "submitting")
        return false;
      set({ submission: "uncertain", error: message });
      return true;
    },
    // "Settled" means the submission outcome is known, not that the saga completed.
    // Call only after a definitive response/reconciliation, never just on timeout.
    markSettled(key) {
      if (
        get().idempotencyKey !== key ||
        !["submitting", "uncertain"].includes(get().submission)
      )
        return false;
      set({ submission: "settled", error: null });
      return true;
    },
    resetCheckout() {
      if (["submitting", "uncertain"].includes(get().submission)) return false;
      set({
        draft: emptyDraft(),
        amountInput: "",
        idempotencyKey: null,
        submission: "idle",
        request: null,
        error: null,
      });
      return true;
    },
  }));
}
export type CheckoutStore = ReturnType<typeof createCheckoutStore>;
