import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockHealthyServices } from "./fixtures/services";

async function fillValid(page: Page) {
  await page
    .getByRole("textbox", { name: "Customer ID", exact: true })
    .fill("11111111-1111-4111-8111-111111111111");
  await page.getByRole("checkbox", { name: /Demo Keyboard/ }).check();
  await page
    .getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    })
    .fill("2");
  await page.getByRole("textbox", { name: "Amount", exact: true }).fill("0.29");
  await page
    .getByRole("textbox", { name: "Recipient", exact: true })
    .fill("Private Demo User");
  await page
    .getByRole("textbox", { name: "Address line 1", exact: true })
    .fill("Private Test Road");
  await page.getByRole("textbox", { name: "City", exact: true }).fill("Dhaka");
  await page
    .getByRole("textbox", { name: "Postal code", exact: true })
    .fill("1200");
  await page
    .getByRole("textbox", { name: "Country code", exact: true })
    .fill("bd");
}
test.beforeEach(async ({ page }) => {
  await mockHealthyServices(page);
});

test("valid checkout has exact summary, shared validation feedback and no order writes", async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/orders/new");
  await fillValid(page);
  await page
    .getByRole("combobox", { name: "Currency", exact: true })
    .selectOption("USD");
  await page
    .getByRole("button", { name: "Validate order", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Order details are valid. No order has been submitted.",
  );
  await expect(
    page.getByRole("region", { name: "Order summary" }),
  ).toContainText("USD 0.29");
  await expect(
    page
      .locator(".checkout-summary .dependency-checks > div")
      .filter({ hasText: "Integer minor units" }),
  ).toHaveText("Integer minor units29");
  await expect(
    page.getByRole("textbox", { name: "Country code", exact: true }),
  ).toHaveValue("BD");
  await expect(
    page.getByRole("button", { name: "Create order", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .press("Enter");
  await expect(page).toHaveURL("/orders/new");
  await expect(page.getByRole("status")).toContainText(
    "No order has been submitted.",
  );
  expect(writes).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("checkout-valid.png"),
    fullPage: true,
  });
});

test("empty and invalid fields have accessible errors, first-error focus, and no stale success", async ({
  page,
}, info) => {
  await page.goto("/orders/new");
  await page
    .getByRole("button", { name: "Validate order", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Customer ID", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Customer ID", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Select at least one product/)).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("checkout-errors.png"),
    fullPage: true,
  });
  await fillValid(page);
  await page
    .getByRole("button", { name: "Validate order", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("1.001");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("99999999.99");
  await expect(
    page.getByRole("region", { name: "Order summary" }),
  ).toContainText("BDT 99999999.99");
  await page
    .getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    })
    .fill("1.5");
  await expect(
    page.getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    }),
  ).toHaveAttribute("aria-invalid", "true");
  await page
    .getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    })
    .fill("10001");
  await expect(
    page.getByRole("spinbutton", {
      name: "Quantity for Demo Keyboard",
      exact: true,
    }),
  ).toHaveAttribute("aria-invalid", "true");
});

test("product selection is deduplicated, removable and zero-stock demo is explicitly labeled", async ({
  page,
}) => {
  await page.goto("/orders/new");
  const checkbox = page.getByRole("checkbox", { name: /Demo Monitor/ });
  await checkbox.check();
  await expect(
    page.getByRole("spinbutton", {
      name: "Quantity for Demo Monitor",
      exact: true,
    }),
  ).toHaveValue("1");
  await expect(page.getByText(/Seeded with zero stock/)).toBeVisible();
  await checkbox.uncheck();
  await expect(
    page.getByRole("spinbutton", {
      name: "Quantity for Demo Monitor",
      exact: true,
    }),
  ).toHaveCount(0);
  await checkbox.check();
  await expect(page.locator(".checkout-summary li")).toHaveCount(1);
  await expect(page.locator(".checkout-summary li")).toHaveText(
    "Demo Monitor × 1",
  );
});

test("draft survives client navigation without storage persistence, and reset/reload clears private fields", async ({
  page,
  isMobile,
}) => {
  await page.goto("/orders/new");
  await fillValid(page);
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("1.001");
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stored).not.toMatch(
    /Private Demo User|Private Test Road|11111111-1111-4111-8111-111111111111/,
  );
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Services", exact: true })
    .click();
  await expect(page).toHaveURL("/services");
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Create Order", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Recipient", exact: true }),
  ).toHaveValue("Private Demo User");
  await expect(
    page.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue("1.001");
  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(
    page.getByRole("textbox", { name: "Recipient", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue("");
  await fillValid(page);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Recipient", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("checkbox", { name: /Demo Keyboard/ }),
  ).not.toBeChecked();
});
