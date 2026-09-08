import { test, expect } from "@playwright/test";
import { mockHealthyServices } from "./fixtures/services";

test.beforeEach(async ({ page }) => {
  await mockHealthyServices(page);
});

const key = "saga:ui:v1";
const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

test("post-mount hydration sanitizes saved preferences and survives navigation/reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|server.render/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.addInitScript(
    ({ key, orderId }) => {
      if (!sessionStorage.getItem("state-test-seeded")) {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            state: {
              recentOrderIds: [orderId.toUpperCase(), "bad-id", orderId],
              rememberRecentOrders: true,
              menuOpen: true,
              draft: { shippingAddress: "PRIVATE ADDRESS" },
              idempotencyKey: "PRIVATE KEY",
            },
          }),
        );
        sessionStorage.setItem("state-test-seeded", "yes");
      }
    },
    { key, orderId },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const expected = {
    version: 1,
    state: { rememberRecentOrders: true, recentOrderIds: [orderId] },
  };
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    )
    .toEqual(expected);
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Orders", exact: true })
    .click();
  await expect(page).toHaveURL("/orders");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.reload();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    )
    .toEqual(expected);
  expect(errors).toEqual([]);
});

test("malformed storage recovers without breaking hydration or drawer interaction", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (key) => localStorage.setItem(key, "broken-json"),
    key,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), key))
    .toBe(
      JSON.stringify({
        version: 1,
        state: { rememberRecentOrders: true, recentOrderIds: [] },
      }),
    );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("blocked browser storage leaves the app and Zustand navigation usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Services", exact: true })
    .click();
  await expect(page).toHaveURL("/services");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("remember-history opt-out removes stale IDs during hydration", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, orderId }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          state: { rememberRecentOrders: false, recentOrderIds: [orderId] },
        }),
      ),
    { key, orderId },
  );
  await page.goto("/orders");
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
    )
    .toEqual({
      version: 1,
      state: { rememberRecentOrders: false, recentOrderIds: [] },
    });
});
