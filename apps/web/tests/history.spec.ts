import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockOrderReads, orderDetailsFixture, readPaths } from "./fixtures/orders";
import { orderId } from "./fixtures/checkout";

const events = [
  { sequence: 2, at: "2026-09-09T06:01:00Z", step: "PAYMENT", direction: "FORWARD", from: "IN_PROGRESS", to: "IN_PROGRESS", summary: "Payment succeeded", event: "STEP_SUCCEEDED", operation: "CHARGE_PAYMENT" },
  { sequence: 1, at: "2026-09-09T06:00:00Z", step: "PAYMENT", direction: "FORWARD", from: null, to: "IN_PROGRESS", summary: "Accepted", event: "ORDER_ACCEPTED" },
];

test("progress and chronological history include accessible raw details on desktop and mobile", async ({ page }, info) => {
  await mockOrderReads(page);
  const state = orderDetailsFixture();
  state.saga.completedSteps = ["PAYMENT", "INVENTORY", "SHIPPING"];
  state.saga.currentOperation = "FINALIZE_INVENTORY";
  state.requiresManualIntervention = true;
  await page.route(`**${readPaths.Order}`, route => route.fulfill({ json: state }));
  await page.route(`**${readPaths.Order}/history`, route => route.fulfill({ json: {
    orderId, status: "IN_PROGRESS", interventionReason: "Reconcile", history: events,
  } }));
  await page.goto(`/orders/${orderId}`);
  const progress = page.getByRole("region", { name: "Saga progress" });
  await expect(progress.getByRole("listitem").nth(2)).toContainText("Succeeded");
  await expect(progress.getByRole("listitem").nth(3)).toContainText("Paused");
  const history = page.getByRole("region", { name: "Order history" });
  await expect(history.getByRole("listitem").first()).toContainText("order was accepted");
  await expect(history.getByRole("listitem").nth(1)).toContainText("Payment succeeded");
  await history.getByText("Raw event details").first().click();
  await expect(history.locator("pre").first()).toBeVisible();
  await expect(history.locator("pre").first()).toContainText("ORDER_ACCEPTED");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("saga-history.png"), fullPage: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("compensation, partial history failure, manual retry, and identity rejection remain independent", async ({ page }) => {
  await mockOrderReads(page);
  const state = orderDetailsFixture();
  state.saga.currentOperation = "CREATE_SHIPMENT";
  state.saga.completedSteps = ["PAYMENT", "INVENTORY"];
  state.saga.compensatedSteps = ["INVENTORY"];
  state.saga.status = "COMPENSATING";
  state.requiresManualIntervention = true;
  await page.route(`**${readPaths.Order}`, route => route.fulfill({ json: state }));
  let mode = "error";
  await page.route(`**${readPaths.Order}/history`, route => route.fulfill(mode === "error"
    ? { status: 503, json: { error: "Unavailable" } }
    : { json: { orderId: mode === "wrong" ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd" : orderId,
      status: "COMPENSATING", interventionReason: null, history: [] } }));
  await page.goto(`/orders/${orderId}`);
  const progress = page.getByRole("region", { name: "Saga progress" });
  await expect(progress.getByRole("listitem").filter({ hasText: "Inventory release" })).toContainText("Succeeded");
  await expect(progress.getByRole("listitem").filter({ hasText: "Payment refund" })).toContainText("Paused");
  const history = page.getByRole("region", { name: "Order history" });
  await expect(history.getByRole("alert")).toContainText("HTTP 503");
  mode = "normal";
  await history.getByRole("button").click();
  await expect(history).toContainText("No history events");
  mode = "wrong";
  await history.getByRole("button").click();
  await expect(history.getByRole("alert")).toContainText("Unable to verify");
});

test("order version changes refresh history through the final terminal snapshot", async ({ page }) => {
  await page.clock.install();
  await mockOrderReads(page);
  let reads = 0;
  let historyReads = 0;
  await page.route(`**${readPaths.Order}`, route => {
    const state = orderDetailsFixture();
    reads++;
    state.saga.version = reads;
    if (reads >= 2) {
      state.saga.completedSteps = ["PAYMENT", "INVENTORY", "SHIPPING"];
      state.saga.inventoryFinalized = true;
      state.saga.status = "COMPLETED";
    }
    return route.fulfill({ json: state });
  });
  await page.route(`**${readPaths.Order}/history`, route => {
    historyReads++;
    return route.fulfill({ json: { orderId, status: reads >= 2 ? "COMPLETED" : "IN_PROGRESS",
      interventionReason: null, history: reads >= 2 ? [...events, { ...events[0], sequence: 3, event: "ORDER_COMPLETED", to: "COMPLETED" }] : events } });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("region", { name: "Order history" })).toContainText("Payment succeeded");
  await page.clock.runFor(2100);
  await expect(page.getByRole("region", { name: "Order history" })).toContainText("All order operations finished");
  expect(historyReads).toBe(2);
  await page.clock.runFor(10000);
  expect(historyReads).toBe(2);
  expect(reads).toBe(2);
});
