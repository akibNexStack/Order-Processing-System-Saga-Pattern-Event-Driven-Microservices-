import type { Page } from "@playwright/test";

export function healthyServiceResponse(service: string, endpoint: string) {
  return endpoint === "health"
    ? {
        service:
          service === "orders" ? "order-orchestrator" : `${service}-service`,
        status: "ok",
      }
    : {
        status: "ready",
        checks: {
          database: true,
          broker: true,
          ...(service === "orders" ? { recovery: true } : {}),
        },
      };
}
export async function mockHealthyServices(page: Page) {
  await page.route("**/api/services/*/*", (route) => {
    const [service, endpoint] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-2);
    return route.fulfill({ json: healthyServiceResponse(service, endpoint) });
  });
}
