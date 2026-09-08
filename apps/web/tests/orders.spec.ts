import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  mockOrderReads,
  orderDetailsFixture,
  participantFixtures,
  readPaths,
} from "./fixtures/orders";
import { orderId, payload } from "./fixtures/checkout";

test("late results for a previous order cannot replace the newly selected order", async ({
  page,
}) => {
  const otherId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === readPaths.Order) {
      await gate;
      return route.fulfill({ json: orderDetailsFixture() });
    }
    if (path === `/api/orders/${otherId}`) {
      const order = orderDetailsFixture();
      order.order.id = otherId;
      order.saga.orderId = otherId;
      order.items = order.items.map((item) => ({ ...item, orderId: otherId }));
      order.order.shippingAddress = {
        ...order.order.shippingAddress,
        recipient: "Second recipient",
      };
      return route.fulfill({ json: order });
    }
    const name = path.includes("payments")
      ? "Payment"
      : path.includes("reservations")
        ? "Reservation"
        : "Shipment";
    return route.fulfill({ status: 404, json: { error: `${name} not found` } });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("Checking order");
  await page.getByRole("link", { name: "Find another order" }).click();
  await page
    .getByRole("textbox", { name: "Order ID", exact: true })
    .fill(otherId);
  await page.getByRole("button", { name: "Find order" }).click();
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("Second recipient");
  const lateResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === readPaths.Order,
  );
  release();
  await lateResponse;
  await expect(page).toHaveURL(`/orders/${otherId}`);
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).not.toContainText("Private Demo User");
});

test("lookup validates IDs and shows complete order and participant snapshots", async ({
  page,
}, info) => {
  await mockOrderReads(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/orders");
  await page
    .getByRole("textbox", { name: "Order ID", exact: true })
    .fill("invalid");
  await page.getByRole("button", { name: "Find order" }).click();
  await expect(
    page.getByRole("textbox", { name: "Order ID", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("Enter a valid order UUID.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Order ID", exact: true })
    .fill(` ${orderId.toUpperCase()} `);
  await page.getByRole("button", { name: "Find order" }).click();
  await expect(page).toHaveURL(`/orders/${orderId}`);
  const overview = page.getByRole("region", { name: "Order overview" });
  for (const text of [
    payload.customerId,
    "BDT 0.29",
    "CHARGE_PAYMENT",
    "Demo Keyboard",
    "Private Test Road",
    "IN_PROGRESS",
  ])
    await expect(overview).toContainText(text);
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toContainText("payment-demo-123");
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toContainText("Outcome: SUCCEEDED");
  await expect(
    page.getByRole("region", { name: "Reservation", exact: true }),
  ).toContainText("RESERVED");
  await expect(
    page.getByRole("region", { name: "Shipment", exact: true }),
  ).toContainText("shipment-demo-123");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("order-details.png"),
    fullPage: true,
  });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).toContain(orderId);
  expect(storage).not.toMatch(/Private Test Road|Private Demo User/);
  expect(writes).toEqual([]);
});

test("recent history supports open, remove, clear, opt-out and reload", async ({
  page,
}) => {
  await mockOrderReads(page);
  await page.goto(`/orders/${orderId}`);
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("BDT 0.29");
  await page.getByRole("link", { name: "Find another order" }).click();
  await expect(
    page
      .getByRole("region", { name: "Recent orders" })
      .getByRole("link", { name: orderId }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: `Remove ${orderId} from recent orders` })
    .click();
  await expect(
    page.getByText("No recent orders", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Remember recent orders in this browser" })
    .uncheck();
  await page
    .getByRole("textbox", { name: "Order ID", exact: true })
    .fill(orderId);
  await page.getByRole("button", { name: "Find order" }).click();
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("BDT 0.29");
  await page.getByRole("link", { name: "Find another order" }).click();
  await expect(page.getByText("History is turned off")).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Remember recent orders in this browser" })
    .check();
  await page
    .getByRole("textbox", { name: "Order ID", exact: true })
    .fill(orderId);
  await page.getByRole("button", { name: "Find order" }).click();
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("BDT 0.29");
  await page.getByRole("link", { name: "Find another order" }).click();
  await page.getByRole("button", { name: "Clear recent orders" }).click();
  await expect(
    page.getByText("No recent orders", { exact: true }),
  ).toBeVisible();
});

test("invalid and missing orders never trigger participant requests or enter recent history", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 404, json: { error: "Order not found" } });
  });
  await page.goto("/orders/not-a-uuid");
  await expect(
    page.getByRole("heading", { name: "Invalid order ID" }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Order not found",
  );
  expect(requests).toHaveLength(1);
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("saga:ui:v1")))!)
      .state.recentOrderIds,
  ).toEqual([]);
});

test("partial failures and not-started records remain independent and refreshable", async ({
  page,
}, info) => {
  await mockOrderReads(page);
  let broken = true;
  let payments = 0;
  let shipments = 0;
  await page.route(`**${readPaths.Payment}`, (route) => {
    payments++;
    return route.fulfill(
      broken
        ? { status: 503, json: { error: "Unavailable" } }
        : { json: participantFixtures().Payment },
    );
  });
  await page.route(`**${readPaths.Reservation}`, (route) =>
    route.fulfill({ status: 404, json: { error: "Reservation not found" } }),
  );
  await page.route(`**${readPaths.Shipment}`, (route) => {
    shipments++;
    return route.fulfill({ json: participantFixtures().Shipment });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toContainText("HTTP 503");
  await expect(
    page.getByRole("region", { name: "Reservation", exact: true }),
  ).toContainText("Not started yet");
  await expect(
    page.getByRole("region", { name: "Shipment", exact: true }),
  ).toContainText("CREATED");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("order-partial-failure.png"),
    fullPage: true,
  });
  broken = false;
  await page.getByRole("button", { name: "Refresh payment" }).click();
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toContainText("CHARGED");
  expect(payments).toBe(2);
  expect(shipments).toBe(1);
  broken = true;
  await page.getByRole("button", { name: "Refresh payment" }).click();
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).not.toContainText("CHARGED");
});

test("wrong-order responses and mismatched participant sagas are not displayed", async ({
  page,
}) => {
  await mockOrderReads(page);
  const wrong = orderDetailsFixture();
  wrong.order.id = payload.customerId;
  await page.route(`**${readPaths.Order}`, (route) =>
    route.fulfill({ json: wrong }),
  );
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unable to verify",
  );
  await expect(page.getByText("Private Test Road")).toHaveCount(0);
  await page.unroute(`**${readPaths.Order}`);
  await page.route(`**${readPaths.Order}`, (route) =>
    route.fulfill({ json: orderDetailsFixture() }),
  );
  const payment = participantFixtures().Payment;
  payment.payment.sagaId = payload.customerId;
  await page.route(`**${readPaths.Payment}`, (route) =>
    route.fulfill({ json: payment }),
  );
  await page.getByRole("button", { name: "Refresh order" }).click();
  await expect(
    page.getByRole("region", { name: "Payment", exact: true }),
  ).toContainText("Unable to verify");
  await expect(
    page.getByRole("region", { name: "Shipment", exact: true }),
  ).toContainText("CREATED");
});

test("refund-only and cancellation-only records are visible alongside absent primary records", async ({
  page,
}) => {
  await mockOrderReads(page);
  const record = participantFixtures().Payment.payment;
  await page.route(`**${readPaths.Payment}`, (route) =>
    route.fulfill({
      json: {
        payment: null,
        refund: {
          ...record,
          paymentId: null,
          providerRefundId: null,
          status: "NOOP",
        },
      },
    }),
  );
  await page.route(`**${readPaths.Shipment}`, (route) =>
    route.fulfill({
      json: {
        shipment: null,
        cancellation: { ...record, shipmentId: null, status: "NOOP" },
      },
    }),
  );
  await page.goto(`/orders/${orderId}`);
  for (const name of ["Payment", "Shipment"]) {
    const card = page.getByRole("region", { name, exact: true });
    await expect(card).toContainText("Not started yet");
    await expect(card).toContainText("NOOP");
  }
});

test("failed saga and intervention reasons are shown without claiming success", async ({
  page,
}) => {
  await mockOrderReads(page);
  const state = orderDetailsFixture();
  state.saga.status = "FAILED";
  state.requiresManualIntervention = true;
  state.requiresCompensation = true;
  state.saga.interventionReason = "Reconcile provider transaction";
  await page.route(`**${readPaths.Order}`, (route) =>
    route.fulfill({ json: state }),
  );
  await page.route(`**${readPaths.Shipment}`, (route) =>
    route.fulfill({ status: 404, json: { error: "Shipment not found" } }),
  );
  await page.goto(`/orders/${orderId}`);
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("FAILED");
  await expect(
    page.getByRole("region", { name: "Order overview" }),
  ).toContainText("Reconcile provider transaction");
  await expect(
    page.getByRole("region", { name: "Shipment", exact: true }),
  ).toContainText("Not started yet");
});
