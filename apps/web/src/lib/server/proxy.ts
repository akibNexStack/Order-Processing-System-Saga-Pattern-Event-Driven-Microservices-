import type { BackendConfig } from "./config";
import type { ServiceName } from "../api/contracts";

type Target = { service: ServiceName; path: string; method: "GET" | "POST" };
const staticTargets: Record<string, Target> = {
  orders: { service: "orders", path: "/orders", method: "POST" },
  "orders/attention": {
    service: "orders",
    path: "/orders/attention",
    method: "GET",
  },
  "payments/charge": {
    service: "payment",
    path: "/payments/charge",
    method: "POST",
  },
  "payments/refund": {
    service: "payment",
    path: "/payments/refund",
    method: "POST",
  },
  "inventory/reserve": {
    service: "inventory",
    path: "/inventory/reserve",
    method: "POST",
  },
  "inventory/release": {
    service: "inventory",
    path: "/inventory/release",
    method: "POST",
  },
  "inventory/finalize": {
    service: "inventory",
    path: "/inventory/finalize",
    method: "POST",
  },
  "shipments/create": {
    service: "shipping",
    path: "/shipments/create",
    method: "POST",
  },
  "shipments/cancel": {
    service: "shipping",
    path: "/shipments/cancel",
    method: "POST",
  },
};

// Match fixed endpoint shapes only. URL segments are encoded, never treated as origins.
export function resolveTarget(segments: string[]): Target | undefined {
  if (
    segments.some(
      (value) =>
        !value ||
        /[\\/\x00-\x1f]/.test(value) ||
        value === "." ||
        value === "..",
    )
  )
    return;
  const key = segments.join("/");
  if (Object.hasOwn(staticTargets, key)) return staticTargets[key];
  const [resource, id, action] = segments;
  if (
    segments.length === 3 &&
    resource === "services" &&
    ["orders", "payment", "inventory", "shipping"].includes(id) &&
    ["health", "ready"].includes(action)
  ) {
    return { service: id as ServiceName, path: `/${action}`, method: "GET" };
  }
  if (
    resource === "orders" &&
    (segments.length === 2 ||
      (segments.length === 3 && ["history", "resume"].includes(action)))
  ) {
    return {
      service: "orders",
      path: `/orders/${encodeURIComponent(id)}${action ? `/${action}` : ""}`,
      method: action === "resume" ? "POST" : "GET",
    };
  }
  if (segments.length === 2 && ["payments", "shipments"].includes(resource)) {
    return {
      service: resource === "payments" ? "payment" : "shipping",
      path: `/${resource}/${encodeURIComponent(id)}`,
      method: "GET",
    };
  }
  if (
    segments.length === 3 &&
    resource === "inventory" &&
    id === "reservations"
  ) {
    return {
      service: "inventory",
      path: `/inventory/reservations/${encodeURIComponent(action)}`,
      method: "GET",
    };
  }
}

const noStore = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export function proxyError(
  status: number,
  code: string,
  error: string,
  extra: Record<string, string> = {},
) {
  return Response.json(
    { error, code },
    { status, headers: { ...noStore, ...extra } },
  );
}

class BodyTooLarge extends Error {}
async function readLimitedBody(request: Request, signal: AbortSignal) {
  const max = 32 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    throw new BodyTooLarge();
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function proxyRequest(
  request: Request,
  segments: string[],
  config: BackendConfig,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const target = resolveTarget(segments);
  if (!target)
    return proxyError(404, "UNKNOWN_ENDPOINT", "Unknown API endpoint");
  if (request.method !== target.method)
    return proxyError(405, "METHOD_NOT_ALLOWED", "Method not allowed", {
      Allow: target.method,
    });
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  try {
    const body =
      request.method === "POST"
        ? await readLimitedBody(request, controller.signal)
        : undefined;
    controller.signal.throwIfAborted();
    const headers = new Headers({ Accept: "application/json" });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const url = new URL(target.path, config.origins[target.service]);
    url.search = new URL(request.url).search;
    const upstream = await fetcher(url, {
      method: target.method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    // A redirect is not a JSON API result. Never follow a new upstream location.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return proxyError(
        502,
        "INVALID_UPSTREAM_RESPONSE",
        "Backend returned an unexpected redirect",
      );
    }
    const type = upstream.headers.get("content-type") ?? "";
    if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(type)) {
      await upstream.body?.cancel();
      return proxyError(
        502,
        "INVALID_UPSTREAM_RESPONSE",
        "Backend returned a non-JSON response",
      );
    }
    const text = await upstream.text();
    controller.signal.throwIfAborted();
    try {
      JSON.parse(text);
    } catch {
      return proxyError(
        502,
        "INVALID_UPSTREAM_RESPONSE",
        "Backend returned invalid JSON",
      );
    }
    const responseHeaders = new Headers({ ...noStore, "Content-Type": type });
    for (const name of ["Retry-After", "Location"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(text, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return proxyError(413, "BODY_TOO_LARGE", "Request body exceeds 32 KiB");
    if (timedOut)
      return proxyError(
        504,
        "BACKEND_TIMEOUT",
        "Backend response timed out; an operation may still have completed. Retry with the original idempotency key.",
        { "Retry-After": "1" },
      );
    if (request.signal.aborted)
      return proxyError(
        499,
        "REQUEST_ABORTED",
        "Request cancelled; an operation may still have completed",
      );
    return proxyError(
      503,
      "BACKEND_UNAVAILABLE",
      "Backend unavailable; retry with the original idempotency key",
      { "Retry-After": "1" },
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
  }
}
