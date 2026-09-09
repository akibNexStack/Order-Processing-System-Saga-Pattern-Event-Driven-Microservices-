import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockOrderReads, orderDetailsFixture, readPaths } from "./fixtures/orders";
import { mockHealthyServices } from "./fixtures/services";
import { orderId } from "./fixtures/checkout";

const attentionRow = () => ({
  orderId, sagaId: orderDetailsFixture().saga.id, status: "IN_PROGRESS",
  operation: "CHARGE_PAYMENT", reason: "COMMAND_RETRIES_EXHAUSTED", updatedAt: "2026-09-09T06:00:00Z",
});
test("overview shows independent readiness, attention, browser recent orders, and a working history link", async ({ page }, info) => {
  await mockHealthyServices(page);
  await mockOrderReads(page);
  await page.route("**/api/orders/attention", route => route.fulfill({ json: { limit: 100, orders: [attentionRow()] } }));
  await page.route("**/api/services/payment/ready", route => route.fulfill({ status: 503, json: {
    status: "not_ready", checks: { database: true, broker: false },
  } }));
  await page.addInitScript(id => localStorage.setItem("saga:ui:v1", JSON.stringify({
    version: 1, state: { rememberRecentOrders: true, recentOrderIds: [id] },
  })), orderId);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "payment readiness", exact: true })).toContainText("Not ready");
  await expect(page.getByRole("region", { name: "orders readiness", exact: true })).toContainText("Ready");
  await expect(page.getByRole("region", { name: "Orders requiring attention" })).toContainText("COMMAND_RETRIES_EXHAUSTED");
  await expect(page.getByRole("region", { name: "Recent orders" })).toContainText(orderId);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("overview-live.png"), fullPage: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("link", { name: "View history" }).click();
  await expect(page).toHaveURL(`/orders/${orderId}#order-history`);
  await expect(page.getByRole("region", { name: "Order history" })).toBeFocused();
});

test("attention handles errors, empty results, and the 100-record cap without reporting a total", async ({ page }) => {
  let mode = "error";
  await page.route("**/api/orders/attention", route => route.fulfill(mode === "error"
    ? { status: 503, json: { error: "Unavailable" } }
    : { json: { limit: 100, orders: mode === "empty" ? [] : Array.from({ length: 100 }, (_, i) => ({
      ...attentionRow(), orderId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    })) } }));
  await page.goto("/attention");
  const list = page.getByRole("region", { name: "Orders requiring attention" });
  await expect(list.getByRole("alert")).toContainText("HTTP 503");
  mode = "empty";
  await list.getByRole("button").click();
  await expect(list).toContainText("No orders requiring attention were returned");
  mode = "full";
  await list.getByRole("button").click();
  await expect(list.getByRole("listitem")).toHaveCount(100);
  await expect(list).toContainText("More orders may require attention");
});

for (const status of [200, 202, 422]) {
  test(`resume ${status} updates state, hides terminal controls, and restarts active polling`, async ({ page }) => {
    await page.clock.install();
    await mockOrderReads(page);
    let state = orderDetailsFixture();
    if (status === 202) state.order.id = orderId.toUpperCase();
    state.requiresManualIntervention = true;
    let posts = 0;
    let reads = 0;
    await page.route(`**${readPaths.Order}`, route => { reads++; return route.fulfill({ json: state }); });
    await page.route(`**${readPaths.Order}/resume`, route => {
      posts++;
      state = { ...state, requiresManualIntervention: false, saga: { ...state.saga,
        version: 2, status: status === 200 ? "COMPLETED" : status === 422 ? "FAILED" : "IN_PROGRESS" } };
      return route.fulfill({ status, json: state });
    });
    await page.goto(`/orders/${orderId}`);
    await page.getByRole("button", { name: "Resume order", exact: true }).click();
    const recovery = page.getByRole("region", { name: "Order recovery" });
    await expect(recovery.getByRole("status")).toContainText(status === 202 ? "Resume accepted" : status === 200 ? "completed" : "failed");
    await expect(page.getByRole("button", { name: "Refresh order" })).toBeEnabled();
    const settledReads = reads;
    await page.clock.runFor(2100);
    if (status === 202) await expect.poll(() => reads).toBeGreaterThan(settledReads);
    else {
      expect(reads).toBe(settledReads);
      await expect(page.getByRole("button", { name: "Resume order", exact: true })).toHaveCount(0);
    }
    expect(posts).toBe(1);
  });
}

test("resume stays locked across rapid clicks and navigation while the POST is pending", async ({ page }) => {
  await mockOrderReads(page);
  const state = orderDetailsFixture();
  state.requiresManualIntervention = true;
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${readPaths.Order}`, route => route.fulfill({ json: state }));
  await page.route(`**${readPaths.Order}/resume`, async route => {
    posts++;
    await gate;
    await route.fulfill({ status: 202, json: state });
  });
  await page.goto(`/orders/${orderId}`);
  const button = page.getByRole("button", { name: "Resume order", exact: true });
  await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page.getByRole("button", { name: "Resuming order…" })).toBeDisabled();
  await page.getByRole("link", { name: "Find another order" }).click();
  await page.getByRole("textbox", { name: "Order ID", exact: true }).fill(orderId);
  await page.getByRole("button", { name: "Find order", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resuming order…" })).toBeDisabled();
  expect(posts).toBe(1);
  release();
  await expect(page.getByRole("region", { name: "Order recovery" })).toContainText("manual intervention is still required");
});

for (const failure of ["503", "404", "409", "malformed", "wrong-order"]) {
  test(`resume ${failure} never claims success or automatically repeats the POST`, async ({ page }) => {
    await page.clock.install();
    await mockOrderReads(page);
    const state = orderDetailsFixture();
    state.requiresManualIntervention = true;
    await page.route(`**${readPaths.Order}`, route => route.fulfill({ json: state }));
    let posts = 0;
    await page.route(`**${readPaths.Order}/resume`, route => {
      posts++;
      return route.fulfill(failure === "malformed" ? { json: {} } : failure === "wrong-order"
        ? { status: 202, json: { ...state, order: { ...state.order, id: state.saga.id } } }
        : { status: Number(failure), json: { error: "Request failed" } });
    });
    await page.goto(`/orders/${orderId}`);
    await page.getByRole("button", { name: "Resume order", exact: true }).click();
    await expect(page.getByRole("region", { name: "Order recovery" }).getByRole("alert")).toContainText("could not be confirmed");
    await page.clock.runFor(10000);
    expect(posts).toBe(1);
    await expect(page.getByRole("region", { name: "Order overview" })).toContainText("IN_PROGRESS");
  });
}
