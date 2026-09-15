import { test, expect, type Page } from "@playwright/test";
import { mockOrderReads, orderDetailsFixture, readPaths } from "./fixtures/orders";

const customer = { user: { id: "11111111-1111-4111-8111-111111111111", email: "customer@example.test", role: "CUSTOMER", emailVerified: true } };
const admin = { user: { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.test", role: "ADMIN", emailVerified: true } };

async function session(page: Page, value: object) {
  await page.route("**/api/auth/session", route => route.fulfill({ json: value }));
}

test("customers cannot see payment approval controls", async ({ page }) => {
  await session(page, customer);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Payment approvals" })).toHaveCount(0);
  await page.goto("/admin/payments");
  await expect(page.getByRole("alert")).toContainText("Administrator access is required");
});

test("only administrators can see payment approval controls", async ({ page }) => {
  await session(page, admin);
  await mockOrderReads(page);
  const order = orderDetailsFixture();
  order.saga.status = "PENDING_PAYMENT";
  order.order.paymentMethod = "BANK_TRANSFER";
  await page.route(`**${readPaths.Order}`, route => route.fulfill({ json: order }));
  await page.goto(`/orders/${order.order.id}`);
  await expect(page.getByRole("button", { name: "Confirm bank-transfer payment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payment approvals" })).toBeVisible();
});
