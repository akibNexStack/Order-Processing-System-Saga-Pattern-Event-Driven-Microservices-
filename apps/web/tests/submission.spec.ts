import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  fillCheckout,
  orderReply,
  orderId,
  payload,
} from "./fixtures/checkout";
import { mockHealthyServices } from "./fixtures/services";
import type { CreateOrderRequest } from "@saga/shared/contracts";

test.beforeEach(async ({ page }) => {
  await mockHealthyServices(page);
});

for (const status of [202, 201, 200, 422])
  test(`${status} saves receipt and history, navigates safely, and requires a new key for a new checkout`, async ({
    page,
  }, info) => {
    const requests: CreateOrderRequest[] = [];
    await page.route("**/api/orders", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        status,
        json: orderReply(body, status),
        headers: { Location: "https://untrusted.invalid/do-not-follow" },
      });
    });
    await page.goto("/orders/new");
    await fillCheckout(page);
    await page
      .getByRole("button", { name: "Create order", exact: true })
      .click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    await expect(page.locator(".submission-receipt")).toHaveCSS(
      "padding",
      "24px",
    );
    await expect(
      page.getByRole("main").getByRole(status === 422 ? "alert" : "status"),
    ).toContainText(
      status === 202
        ? "Processing is not complete"
        : status === 422
          ? "saga failed"
          : "completed successfully",
    );
    const saved = await page.evaluate(() => localStorage.getItem("saga:ui:v1"));
    expect(JSON.parse(saved!).state.recentOrderIds).toEqual([orderId]);
    expect(saved).not.toMatch(/Private Test Road|Private Demo User/);
    expect(requests[0].payload).toEqual(payload);
    expect(requests[0].idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (status === 202)
      await page.screenshot({
        path: info.outputPath("submission-receipt.png"),
        fullPage: true,
      });
    await page.getByRole("link", { name: "Return to checkout" }).click();
    await expect(
      page.getByRole("button", { name: "Create order", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Start new checkout" }).click();
    await fillCheckout(page);
    await page
      .getByRole("button", { name: "Create order", exact: true })
      .click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    expect(requests).toHaveLength(2);
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
    await page.reload();
    await expect(
      page.getByText(/No submission receipt is available/),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
  });

for (const mode of [
  "503",
  "network",
  "malformed",
  "unverified-422",
  "mismatch",
])
  test(`${mode} preserves the original request and key for explicit retry`, async ({
    page,
  }, info) => {
    const requests: string[] = [];
    await page.route("**/api/orders", async (route) => {
      requests.push(route.request().postData()!);
      const body = route.request().postDataJSON();
      if (requests.length > 1)
        return route.fulfill({ status: 202, json: orderReply(body) });
      if (mode === "network") return route.abort("failed");
      if (mode === "malformed")
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: "broken",
        });
      if (mode === "mismatch") {
        const wrong = orderReply(body);
        wrong.order.idempotencyKey = "other-key";
        return route.fulfill({ status: 202, json: wrong });
      }
      await route.fulfill({
        status: mode === "503" ? 503 : 422,
        json: { error: "Unavailable" },
      });
    });
    await page.goto("/orders/new");
    await fillCheckout(page);
    await page
      .getByRole("button", { name: "Create order", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "It may already be saved",
    );
    await expect(
      page.getByRole("textbox", { name: "Amount", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Clear draft" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Create order", exact: true }),
    ).toBeDisabled();
    expect(requests).toHaveLength(1);
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    if (mode === "503") {
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath("submission-uncertain.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Retry original request" }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  });

test("409 shows conflict without a retry or fabricated order ID", async ({
  page,
}) => {
  let count = 0;
  await page.route("**/api/orders", async (route) => {
    count++;
    await route.fulfill({ status: 409, json: { error: "Conflict" } });
  });
  await page.goto("/orders/new");
  await fillCheckout(page);
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Idempotency conflict (409)",
  );
  await expect(
    page.getByRole("button", { name: "Retry original request" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create order", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start new checkout" }),
  ).toBeEnabled();
  expect(count).toBe(1);
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("saga:ui:v1")))!)
      .state.recentOrderIds,
  ).toEqual([]);
});

test("in-flight double clicks and navigation do not duplicate or lose a submission", async ({
  page,
  isMobile,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let count = 0;
  await page.route("**/api/orders", async (route) => {
    count++;
    await gate;
    await route.fulfill({
      status: 202,
      json: orderReply(route.request().postDataJSON()),
    });
  });
  await page.goto("/orders/new");
  await fillCheckout(page);
  await page
    .getByRole("button", { name: "Create order", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole("status")).toContainText("Submitting order");
  await expect(
    page.getByRole("button", { name: "Create order", exact: true }),
  ).toBeDisabled();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Services", exact: true })
    .click();
  await expect(page).toHaveURL("/services");
  release();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page.evaluate(() => localStorage.getItem("saga:ui:v1")))!,
        ).state.recentOrderIds,
    )
    .toEqual([orderId]);
  await expect(page).toHaveURL("/services");
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Create Order", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "View submitted order" }),
  ).toBeVisible();
  expect(count).toBe(1);
});

test("Retry-After delays retry and invalid forms never submit", async ({
  page,
}) => {
  let count = 0;
  await page.route("**/api/orders", async (route) => {
    count++;
    await route.fulfill({
      status: 503,
      headers: { "Retry-After": "3" },
      json: { error: "Unavailable" },
    });
  });
  await page.goto("/orders/new");
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Customer ID", exact: true }),
  ).toBeFocused();
  expect(count).toBe(0);
  await fillCheckout(page);
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry original request" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Retry original request" }),
  ).toBeEnabled({ timeout: 7000 });
  expect(count).toBe(1);
});

test("history opt-out allows submission without saving IDs", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "saga:ui:v1",
      JSON.stringify({
        version: 1,
        state: { rememberRecentOrders: false, recentOrderIds: [] },
      }),
    ),
  );
  await page.route("**/api/orders", (route) =>
    route.fulfill({
      status: 202,
      json: orderReply(route.request().postDataJSON()),
    }),
  );
  await page.goto("/orders/new");
  await fillCheckout(page);
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  await expect(page).toHaveURL(`/orders/${orderId}`);
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("saga:ui:v1")))!)
      .state.recentOrderIds,
  ).toEqual([]);
});
