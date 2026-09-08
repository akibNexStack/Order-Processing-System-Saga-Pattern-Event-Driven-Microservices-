import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockHealthyServices } from "./fixtures/services";

test.beforeEach(async ({ page }) => {
  await mockHealthyServices(page);
});

const pages = [
  { path: "/", heading: "Overview", nav: "Overview" },
  { path: "/orders/new", heading: "Create order", nav: "Create Order" },
  { path: "/orders", heading: "Orders", nav: "Orders" },
  { path: "/attention", heading: "Attention", nav: "Attention" },
  { path: "/services", heading: "Services", nav: "Services" },
];

for (const target of pages) {
  test(`${target.path} loads directly with accurate navigation and accessible content`, async ({
    page,
    isMobile,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(target.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      target.heading,
    );
    await expect(page).toHaveTitle(`${target.nav} | Saga`);
    await expect(page.getByRole("main")).toHaveCount(1);
    if (target.path === "/services") {
      await expect(page.getByText("Ready", { exact: true })).toHaveCount(4);
      await expect(
        page.getByText("Live service checks · Read-only"),
      ).toBeVisible();
    } else if (target.path === "/orders/new")
      await expect(
        page.getByRole("main").getByText(/Demo checkout · Validation only/),
      ).toBeVisible();
    else await expect(page.getByText("Workspace preview.")).toBeVisible();
    if (isMobile)
      await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      nav.getByRole("link", { name: target.nav, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (isMobile)
      await page.getByRole("button", { name: "Close navigation" }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("page.png"),
      fullPage: true,
    });
  });
}

test("navigation and browser history keep the active item accurate", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  for (const target of pages.slice(1)) {
    if (isMobile)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: target.nav, exact: true })
      .click();
    await expect(page).toHaveURL(target.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      target.heading,
    );
    if (isMobile) await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page.goBack();
  await expect(page).toHaveURL("/attention");
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Attention", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("checkout validation is editable but submission stays disabled and service checks are read-only", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/orders/new");
  for (const label of [
    "Customer ID",
    "Amount",
    "Currency",
    "Recipient",
    "Address line 1",
  ])
    await expect(
      page.getByRole(label === "Currency" ? "combobox" : "textbox", {
        name: label,
        exact: true,
      }),
    ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Create order" }),
  ).toBeDisabled();
  await page.goto("/orders");
  await expect(page.getByLabel("Order ID", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Find order" })).toBeDisabled();
  await page.goto("/services");
  await expect(page.getByText("Responding", { exact: true })).toHaveCount(4);
  expect(writes).toEqual([]);
});

test("unknown routes have a recovery link", async ({ page }) => {
  const response = await page.goto("/missing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Page not found",
  );
  await page.getByRole("link", { name: "Back to overview" }).click();
  await expect(page).toHaveURL("/");
});

test("skip link provides keyboard access to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("mobile drawer traps focus, closes correctly, and resets after resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer.getByRole("link", { name: "Services", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeFocused();
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.mouse.click(375, 150);
  await expect(drawer).not.toBeVisible();
  await trigger.click();
  await drawer.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("pages fit narrow phones, tablets, and desktop without horizontal scrolling", async ({
  page,
}) => {
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of pages) {
      await page.goto(target.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${target.path} overflows at ${width}px`).toBe(false);
    }
  }
});
