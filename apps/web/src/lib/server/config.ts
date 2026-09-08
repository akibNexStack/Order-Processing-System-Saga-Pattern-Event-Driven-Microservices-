import type { ServiceName } from "../api/contracts";

export interface BackendConfig {
  origins: Record<ServiceName, string>;
  timeoutMs: number;
}

// Pure parser: process.env is read only in the server-only entrypoint.
export function parseBackendConfig(
  env: Record<string, string | undefined>,
): BackendConfig {
  const entries = [
    ["orders", "ORDERS_SERVICE_URL", 3000],
    ["payment", "PAYMENT_SERVICE_URL", 3001],
    ["inventory", "INVENTORY_SERVICE_URL", 3002],
    ["shipping", "SHIPPING_SERVICE_URL", 3003],
  ] as const;
  const origins = {} as Record<ServiceName, string>;
  for (const [service, key, port] of entries) {
    const url = new URL(env[key] ?? `http://127.0.0.1:${port}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        `Invalid ${key}: expected an HTTP(S) origin without credentials or a path`,
      );
    }
    origins[service] = url.origin;
  }
  const timeoutMs = Number(env.BACKEND_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000)
    throw new Error("Invalid BACKEND_TIMEOUT_MS");
  return { origins, timeoutMs };
}
