import { test, expect } from "@playwright/test";
import { orderId } from "./fixtures/checkout";
import { mockOrderReads, orderDetailsFixture, readPaths } from "./fixtures/orders";

test("initial temporary failures back off, recover, and reset to two seconds", async ({ page }) => {
  await page.clock.install();
  await mockOrderReads(page);
  let reads = 0;
  await page.route(`**${readPaths.Order}`, route => {
    reads++;
    return route.fulfill(reads <= 2
      ? { status: 503, json: { error: "Unavailable" } }
      : { json: orderDetailsFixture() });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("HTTP 503");
  await page.clock.runFor(3_000);
  expect(reads).toBe(1);
  await page.clock.runFor(1_100);
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("button", { name: "Refresh order" })).toBeEnabled();
  await page.clock.runFor(7_000);
  expect(reads).toBe(2);
  await page.clock.runFor(1_100);
  await expect.poll(() => reads).toBe(3);
  await expect(page.getByRole("region", { name: "Order overview" })).toContainText("IN_PROGRESS");
  await page.clock.runFor(2_100);
  await expect.poll(() => reads).toBe(4);
});

test("slow manual refresh keeps details mounted, prevents overlap, and aborts on navigation", async ({ page }) => {
  await page.clock.install();
  await mockOrderReads(page);
  let reads = 0;
  let participants = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.on("request", request => {
    if (Object.values(readPaths).slice(1).includes(new URL(request.url()).pathname))
      participants++;
  });
  await page.route(`**${readPaths.Order}`, async route => {
    reads++;
    if (reads > 1) await gate;
    await route.fulfill({ json: orderDetailsFixture() });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("region", { name: "Shipment", exact: true })).toContainText("CREATED");
  await page.getByRole("button", { name: "Refresh order" }).click();
  await expect.poll(() => reads).toBe(2);
  await page.clock.runFor(8_000);
  expect(reads).toBe(2);
  expect(participants).toBe(3);
  await expect(page.getByRole("region", { name: "Order overview" })).toContainText("Private Test Road");
  await expect(page.getByRole("region", { name: "Shipment", exact: true })).toContainText("CREATED");
  const cancelled = page.waitForEvent("requestfailed", {
    predicate: request => new URL(request.url()).pathname === readPaths.Order,
  });
  await page.getByRole("link", { name: "Find another order" }).click();
  await cancelled;
  release();
  await page.clock.runFor(30_000);
  expect(reads).toBe(2);
});

test("FAILED stops polling and a manually refreshed active snapshot restarts it", async ({ page }) => {
  await page.clock.install();
  await mockOrderReads(page);
  let reads = 0;
  let active = false;
  await page.route(`**${readPaths.Order}`, route => {
    reads++;
    const state = orderDetailsFixture();
    if (!active) state.saga.status = "FAILED";
    return route.fulfill({ json: state });
  });
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole("region", { name: "Order overview" })).toContainText("FAILED");
  await page.clock.runFor(10_000);
  expect(reads).toBe(1);
  active = true;
  await page.getByRole("button", { name: "Refresh order" }).click();
  await expect(page.getByRole("region", { name: "Order overview" })).toContainText("IN_PROGRESS");
  await page.clock.runFor(2_100);
  await expect.poll(() => reads).toBe(3);
});
