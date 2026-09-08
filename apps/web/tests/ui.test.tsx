import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/ui/button";
import { Input } from "../src/components/ui/input";
import { LoadingState } from "../src/components/ui/loading-state";
import { ErrorState } from "../src/components/ui/error-state";
import { StatusBadge } from "../src/components/ui/status-badge";
import { currentNavigation } from "../src/components/layout/navigation";

test("shared buttons do not accidentally submit forms and accept explicit submission", () => {
  assert.match(renderToStaticMarkup(<Button>Action</Button>), /type="button"/);
  assert.match(
    renderToStaticMarkup(
      <Button type="submit" disabled>
        Submit
      </Button>,
    ),
    /type="submit".*disabled/,
  );
});

test("input associates its label, hint, and error and exposes invalid state", () => {
  const markup = renderToStaticMarkup(
    <Input
      id="order"
      label="Order ID"
      hint="Use a UUID"
      error="Invalid order ID"
      aria-describedby="external-help"
      required
    />,
  );
  assert.match(markup, /for="order"/);
  assert.match(
    markup,
    /aria-describedby="external-help order-hint order-error"/,
  );
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /id="order-hint"/);
  assert.match(markup, /id="order-error"/);
});

test("loading and error states announce their message and retry stays optional", () => {
  assert.match(
    renderToStaticMarkup(<LoadingState label="Loading orders" />),
    /role="status".*Loading orders/,
  );
  const error = renderToStaticMarkup(
    <ErrorState description="Connection unavailable" />,
  );
  assert.match(error, /role="alert".*Connection unavailable/);
  assert.doesNotMatch(error, /<button/);
  assert.match(
    renderToStaticMarkup(<ErrorState onRetry={() => {}} />),
    /Try again/,
  );
});

test("status meaning is expressed as text, not only color", () => {
  for (const tone of [
    "neutral",
    "success",
    "warning",
    "danger",
    "info",
  ] as const) {
    assert.match(
      renderToStaticMarkup(
        <StatusBadge tone={tone}>Not connected</StatusBadge>,
      ),
      /Not connected/,
    );
  }
});

test("create order has its own active item and order detail paths belong to Orders", () => {
  assert.equal(currentNavigation("/orders/new")?.label, "Create Order");
  assert.equal(currentNavigation("/orders/example/history")?.label, "Orders");
  assert.equal(currentNavigation("/missing"), undefined);
});
