import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  healthyServiceResponse,
  mockHealthyServices,
} from "./fixtures/services";

test("initial loading resolves to independent health/readiness results and timestamps", async ({
  page,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths = new Set<string>();
  await page.route("**/api/services/*/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.add(path);
    const [service, endpoint] = path.split("/").slice(-2);
    await gate;
    await route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
  await page.goto("/services");
  await expect(
    page.getByRole("button", { name: "Checking services…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Checking…" }),
  ).toHaveCount(8);
  release();
  await expect(page.getByText("Responding", { exact: true })).toHaveCount(4);
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
  await expect(page.locator("time[datetime]")).toHaveCount(8);
  expect(paths.size).toBe(8);
  await expect(page.getByText("Order recovery", { exact: true })).toHaveCount(
    1,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("services-healthy.png"),
    fullPage: true,
  });
});

test("partial outages keep available services visible and show dependency failures separately", async ({
  page,
}, info) => {
  await page.route("**/api/services/*/*", async (route) => {
    const [service, endpoint] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-2);
    if (service === "orders" && endpoint === "ready")
      return route.fulfill({
        status: 503,
        json: {
          status: "not_ready",
          checks: { database: true, broker: false, recovery: false },
        },
      });
    if (service === "payment" && endpoint === "ready")
      return route.fulfill({
        status: 503,
        json: { status: "not_ready", checks: { configured: false } },
      });
    if (service === "inventory")
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    return route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
  await page.goto("/services");
  const orders = page.getByRole("region", {
    name: "Order Orchestrator",
    exact: true,
  });
  await expect(orders.getByText("Not ready", { exact: true })).toBeVisible();
  await expect(
    orders.locator(".dependency-checks > div").filter({ hasText: "Broker" }),
  ).toHaveText("BrokerUnavailable");
  await expect(
    orders
      .locator(".dependency-checks > div")
      .filter({ hasText: "Order recovery" }),
  ).toHaveText("Order recoveryUnavailable");
  await expect(
    page.getByText("Readiness checks are not configured."),
  ).toBeVisible();
  const inventory = page.getByRole("region", {
    name: "Inventory",
    exact: true,
  });
  await expect(
    inventory.getByRole("status").filter({ hasText: "Unavailable" }),
  ).toHaveCount(2);
  await expect(inventory.getByText("Unknown", { exact: true })).toHaveCount(2);
  await expect(
    page
      .getByRole("region", { name: "Shipping", exact: true })
      .getByText("Ready", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("services-partial-outage.png"),
    fullPage: true,
  });
});

test("per-service refresh and refresh-all issue only GETs and replace stale successes after failure", async ({
  page,
}) => {
  let failPayment = false;
  const requests: string[] = [];
  await page.route("**/api/services/*/*", async (route) => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const [service, endpoint] = path.split("/").slice(-2);
    if (service === "payment" && failPayment)
      return route.fulfill({ status: 504, json: { error: "Timeout" } });
    return route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
  await page.goto("/services");
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
  requests.length = 0;
  failPayment = true;
  await page
    .getByRole("button", { name: "Refresh Payment", exact: true })
    .click();
  const payment = page.getByRole("region", { name: "Payment", exact: true });
  await expect(
    payment.getByText("Check timed out. Try refreshing."),
  ).toHaveCount(2);
  await expect(payment.getByText("Ready", { exact: true })).toHaveCount(0);
  await expect(payment.getByText("Available", { exact: true })).toHaveCount(0);
  await expect(payment.getByText(/Last attempt:/)).toHaveCount(2);
  expect(requests.sort()).toEqual([
    "/api/services/payment/health",
    "/api/services/payment/ready",
  ]);
  requests.length = 0;
  failPayment = false;
  await page
    .getByRole("button", { name: "Refresh all services", exact: true })
    .click();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
  expect(requests.length).toBe(8);
});

test("invalid JSON, wrong service identity, inconsistent readiness and missing recovery are not shown as healthy", async ({
  page,
}) => {
  await page.route("**/api/services/*/*", (route) => {
    const [service, endpoint] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-2);
    if (service === "payment" && endpoint === "health")
      return route.fulfill({
        json: { status: "ok", service: "shipping-service" },
      });
    if (service === "inventory" && endpoint === "health")
      return route.fulfill({ contentType: "application/json", body: "broken" });
    if (service === "shipping" && endpoint === "ready")
      return route.fulfill({
        json: { status: "ready", checks: { database: false, broker: true } },
      });
    if (service === "orders" && endpoint === "ready")
      return route.fulfill({
        json: { status: "ready", checks: { database: true, broker: true } },
      });
    return route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
  await page.goto("/services");
  await expect(
    page.getByText(
      "Invalid response. The service status could not be verified.",
    ),
  ).toHaveCount(3);
  await expect(
    page.getByText("Incomplete checks", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Required dependency results were not reported."),
  ).toBeVisible();
});

test("a slow service does not block other cards or their refresh controls", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/services/*/*", async (route) => {
    const [service, endpoint] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-2);
    if (service === "payment" && endpoint === "ready") await gate;
    await route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
  try {
    await page.goto("/services");
    await expect(page.getByText("Ready", { exact: true })).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Refresh Shipping", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("region", { name: "Payment readiness", exact: true }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(
      page
        .getByRole("region", { name: "Payment health", exact: true })
        .getByText("Responding", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
});

test("network failures are recoverable and all-down state does not crash the page", async ({
  page,
}) => {
  await page.route("**/api/services/*/*", (route) => route.abort("failed"));
  await page.goto("/services");
  await expect(
    page.getByRole("status").filter({ hasText: "Unavailable" }),
  ).toHaveCount(8);
  await expect(page.getByText("Unknown", { exact: true })).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: "Refresh all services" }),
  ).toBeEnabled();
  await page.unroute("**/api/services/*/*");
  await mockHealthyServices(page);
  await page.getByRole("button", { name: "Refresh all services" }).click();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
});
