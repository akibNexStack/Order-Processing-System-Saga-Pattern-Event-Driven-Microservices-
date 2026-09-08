"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ShippingAddress } from "@saga/shared/contracts";
import {
  useCheckoutStore,
  useCheckoutStoreApi,
  useUiStore,
} from "@/components/providers/state-provider";
import { useCreateOrderMutation } from "@/lib/api/api";
import { submitCheckout } from "@/lib/checkout/submission";
import {
  demoProducts,
  formatMinor,
  validateCheckoutDraft,
} from "@/lib/checkout/form";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, ButtonLink } from "@/components/ui/button";

const addressFields: {
  key: keyof ShippingAddress;
  label: string;
  required?: boolean;
  maxLength: number;
  autoComplete: string;
}[] = [
  {
    key: "recipient",
    label: "Recipient",
    required: true,
    maxLength: 200,
    autoComplete: "shipping name",
  },
  {
    key: "line1",
    label: "Address line 1",
    required: true,
    maxLength: 200,
    autoComplete: "shipping address-line1",
  },
  {
    key: "line2",
    label: "Address line 2 (optional)",
    maxLength: 200,
    autoComplete: "shipping address-line2",
  },
  {
    key: "city",
    label: "City",
    required: true,
    maxLength: 200,
    autoComplete: "shipping address-level2",
  },
  {
    key: "region",
    label: "Region (optional)",
    maxLength: 200,
    autoComplete: "shipping address-level1",
  },
  {
    key: "postalCode",
    label: "Postal code",
    required: true,
    maxLength: 20,
    autoComplete: "shipping postal-code",
  },
  {
    key: "countryCode",
    label: "Country code",
    required: true,
    maxLength: 2,
    autoComplete: "shipping country",
  },
];

export function CheckoutForm() {
  const draft = useCheckoutStore((state) => state.draft);
  const updateDraft = useCheckoutStore((state) => state.updateDraft);
  const amount = useCheckoutStore((state) => state.amountInput);
  const setAmount = useCheckoutStore((state) => state.setAmountInput);
  const reset = useCheckoutStore((state) => state.resetCheckout);
  const phase = useCheckoutStore((state) => state.submission);
  const submissionError = useCheckoutStore((state) => state.error);
  const receipt = useCheckoutStore((state) => state.receipt);
  const key = useCheckoutStore((state) => state.idempotencyKey);
  const retryAt = useCheckoutStore((state) => state.retryAt);
  const checkout = useCheckoutStoreApi();
  const remember = useUiStore((state) => state.addRecentOrder);
  const hydration = useUiStore((state) => state.hydration);
  const [createOrder] = useCreateOrderMutation();
  const router = useRouter();
  const mounted = useRef(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (phase !== "uncertain") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [phase, retryAt]);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [validated, setValidated] = useState(false);
  const validation = validateCheckoutDraft(draft);
  const errors = attempted ? validation.errors : {};
  const locked = phase !== "idle";
  const edit = (patch: Parameters<typeof updateDraft>[0]) => {
    if (updateDraft(patch)) setValidated(false);
  };
  function validate(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setAttempted(true);
    setValidated(validation.parsed.success);
    if (!validation.parsed.success)
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
  }
  async function submit(retry = false) {
    if (hydration === "pending") return;
    setAttempted(true);
    setValidated(false);
    if (!retry && !validation.parsed.success) {
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    const result = await submitCheckout(
      checkout,
      (request) => createOrder(request).unwrap(),
      remember,
      retry,
    );
    if (
      result?.orderId &&
      mounted.current &&
      window.location.pathname === "/orders/new"
    ) {
      router.push(`/orders/${result.orderId}`);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="CHECKOUT"
        title="Create order"
        description="Choose demo products, enter delivery details, and submit your order."
      />
      <p className="checkout-notice">
        Demo checkout · Live submission. Create order sends a real request to
        the configured backend, which may charge, reserve inventory, and arrange
        shipping. Validate order checks locally only. Drafts and retry keys stay
        in memory in this tab and are lost on reload or close. Keep this tab
        open until the submission outcome is known.
      </p>
      <div className="content-columns checkout-columns">
        <Card className="checkout-card">
          <form ref={formRef} noValidate onSubmit={validate}>
            {phase === "submitting" && (
              <p role="status">
                Submitting order… Please wait. The original request is locked to
                prevent duplicate submissions.
              </p>
            )}
            {submissionError && (
              <p role="alert" className="field-error">
                {submissionError}
              </p>
            )}
            {receipt && (
              <div role={receipt.status >= 400 ? "alert" : "status"}>
                <p>{receipt.message}</p>
                {receipt.orderId && (
                  <ButtonLink href={`/orders/${receipt.orderId}`}>
                    View submitted order
                  </ButtonLink>
                )}
              </div>
            )}
            {key && (
              <p className="field-hint submission-key">
                Idempotency key: <code>{key}</code>
              </p>
            )}
            {attempted && !validation.parsed.success && (
              <p role="alert" className="field-error">
                Please correct the highlighted fields before continuing.
              </p>
            )}
            <fieldset disabled={locked} className="checkout-fields">
              <legend>Customer and products</legend>
              <Input
                id="customer-id"
                label="Customer ID"
                required
                value={draft.customerId}
                onChange={(event) => edit({ customerId: event.target.value })}
                error={errors.customerId}
                placeholder="Customer UUID"
                autoComplete="off"
              />
              <fieldset
                className="demo-products"
                aria-describedby="demo-products-note"
              >
                <legend>Demo products</legend>
                <p id="demo-products-note">
                  These IDs match the inventory seed. Initial stock is shown for
                  context only—not live availability. Products have no catalog
                  prices.
                </p>
                {errors.items && (
                  <p id="items-error" className="field-error">
                    Select at least one product. {errors.items}
                  </p>
                )}
                {demoProducts.map((product) => {
                  const index = draft.items.findIndex(
                    (item) => item.productId === product.id,
                  );
                  const item = draft.items[index];
                  return (
                    <div className="demo-product" key={product.id}>
                      <label className="demo-product-choice">
                        <input
                          type="checkbox"
                          checked={!!item}
                          aria-invalid={!!errors.items}
                          aria-describedby={
                            errors.items ? "items-error" : undefined
                          }
                          onChange={(event) =>
                            edit({
                              items: event.target.checked
                                ? [
                                    ...draft.items,
                                    { productId: product.id, quantity: 1 },
                                  ]
                                : draft.items.filter(
                                    (value) => value.productId !== product.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          {product.name}
                          <small>
                            {product.sku} · Initial seed stock:{" "}
                            {product.initialStock}
                          </small>
                        </span>
                      </label>
                      {product.initialStock === 0 && (
                        <p className="field-hint">
                          Seeded with zero stock for insufficient-stock
                          demonstrations. Current stock is not checked here.
                        </p>
                      )}
                      {item && (
                        <Input
                          label={`Quantity for ${product.name}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={10000}
                          step={1}
                          required
                          value={
                            Number.isFinite(item.quantity) ? item.quantity : ""
                          }
                          onChange={(event) =>
                            edit({
                              items: draft.items.map((value) =>
                                value.productId === product.id
                                  ? {
                                      ...value,
                                      quantity:
                                        event.target.value === ""
                                          ? NaN
                                          : Number(event.target.value),
                                    }
                                  : value,
                              ),
                            })
                          }
                          error={errors[`items.${index}.quantity`]}
                          hint="Whole number from 1 to 10,000."
                        />
                      )}
                    </div>
                  );
                })}
              </fieldset>
            </fieldset>
            <fieldset disabled={locked} className="checkout-fields">
              <legend>Demo amount</legend>
              <p className="field-hint">
                Enter a total manually for testing. This is not a calculated
                price or a payment quote. Changing currency does not convert the
                amount.
              </p>
              <div className="field-grid">
                <Input
                  label="Amount"
                  id="order-amount"
                  required
                  inputMode="decimal"
                  value={amount}
                  placeholder="0.00"
                  onChange={(event) => {
                    if (setAmount(event.target.value)) setValidated(false);
                  }}
                  error={errors.amountMinor}
                  hint="0.01–99,999,999.99; up to two decimal places."
                  autoComplete="off"
                />
                <div className="field">
                  <label htmlFor="order-currency">
                    Currency <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="order-currency"
                    className="input"
                    required
                    value={draft.currency}
                    aria-invalid={!!errors.currency}
                    aria-describedby={
                      errors.currency ? "currency-error" : undefined
                    }
                    onChange={(event) =>
                      edit({ currency: event.target.value as "BDT" | "USD" })
                    }
                  >
                    <option value="BDT">BDT</option>
                    <option value="USD">USD</option>
                  </select>
                  {errors.currency && (
                    <p id="currency-error" className="field-error">
                      {errors.currency}
                    </p>
                  )}
                </div>
              </div>
            </fieldset>
            <fieldset disabled={locked} className="checkout-fields">
              <legend>Shipping address</legend>
              <div className="field-grid">
                {addressFields.map((field) => (
                  <Input
                    key={field.key}
                    id={`shipping-${field.key}`}
                    label={field.label}
                    required={field.required}
                    maxLength={field.maxLength}
                    autoComplete={field.autoComplete}
                    value={draft.shippingAddress[field.key] ?? ""}
                    onChange={(event) =>
                      edit({
                        shippingAddress: {
                          ...draft.shippingAddress,
                          [field.key]:
                            field.key === "countryCode"
                              ? event.target.value.toUpperCase()
                              : event.target.value,
                        },
                      })
                    }
                    error={errors[`shippingAddress.${field.key}`]}
                    hint={
                      field.key === "countryCode"
                        ? "Two uppercase letters, for example BD or US."
                        : undefined
                    }
                  />
                ))}
              </div>
            </fieldset>
            <div className="checkout-actions">
              <Button type="submit" disabled={locked}>
                Validate order
              </Button>
              <Button
                variant="secondary"
                disabled={phase === "submitting" || phase === "uncertain"}
                onClick={() => {
                  if (reset()) {
                    setAttempted(false);
                    setValidated(false);
                  }
                }}
              >
                {phase === "settled" ? "Start new checkout" : "Clear draft"}
              </Button>
              <Button
                disabled={locked || hydration === "pending"}
                onClick={() => void submit()}
                aria-describedby="submission-notice"
              >
                Create order
              </Button>
              {phase === "uncertain" && (
                <Button
                  onClick={() => void submit(true)}
                  disabled={now < retryAt}
                >
                  Retry original request
                </Button>
              )}
            </div>
            <p id="submission-notice" className="field-hint">
              Create order submits to the backend. Pressing Enter in a field
              only validates.
              {phase === "uncertain" &&
                now < retryAt &&
                ` Retry available in ${Math.ceil((retryAt - now) / 1000)} seconds.`}
            </p>
            {validated && validation.parsed.success && (
              <p role="status" className="checkout-valid">
                Order details are valid. No order has been submitted.
              </p>
            )}
          </form>
        </Card>
        <Card
          className="side-guide checkout-summary"
          aria-labelledby="summary-title"
        >
          <h2 id="summary-title">Order summary</h2>
          {draft.items.length ? (
            <ul>
              {draft.items.map((item) => (
                <li key={item.productId}>
                  {demoProducts.find((product) => product.id === item.productId)
                    ?.name ?? item.productId}{" "}
                  ×{" "}
                  {Number.isInteger(item.quantity) &&
                  item.quantity >= 1 &&
                  item.quantity <= 10000
                    ? item.quantity
                    : "Invalid quantity"}
                </li>
              ))}
            </ul>
          ) : (
            <p>No products selected.</p>
          )}
          <dl className="dependency-checks">
            <div>
              <dt>Demo total</dt>
              <dd>
                {draft.amountMinor === null
                  ? "Not valid yet"
                  : `${draft.currency} ${formatMinor(draft.amountMinor)}`}
              </dd>
            </div>
            <div>
              <dt>Integer minor units</dt>
              <dd>{draft.amountMinor ?? "—"}</dd>
            </div>
          </dl>
          <p>
            Recipient: {draft.shippingAddress.recipient.trim() || "Not entered"}
          </p>
          <p>
            {[
              draft.shippingAddress.line1,
              draft.shippingAddress.line2,
              draft.shippingAddress.city,
              draft.shippingAddress.region,
              draft.shippingAddress.postalCode,
              draft.shippingAddress.countryCode,
            ]
              .filter((value) => value?.trim())
              .join(", ")}
          </p>
          <p>
            Product availability and payment acceptance are checked by the
            backend only after submission—not by this validation.
          </p>
        </Card>
      </div>
    </>
  );
}
