import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackendConfig } from "../../src/lib/server/config";
import { proxyRequest, resolveTarget } from "../../src/lib/server/proxy";

const config = parseBackendConfig({});
test("hosted proxy requires a secret and replaces browser authorization", async () => {
  assert.throws(() => parseBackendConfig({ VERCEL: "1" }));
  assert.throws(() => parseBackendConfig({ BACKEND_API_TOKEN: "short" }));
  const secret = "s".repeat(48);
  const hosted = parseBackendConfig({ VERCEL: "1", BACKEND_API_TOKEN: secret });
  const response = await proxyRequest(new Request("https://demo.test/api/orders/x", {
    headers: { authorization: "Bearer attacker", cookie: "private=value" },
  }), ["orders", "x"], hosted, async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(headers.get("cookie"), null);
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(secret), false);
  assert.equal(response.headers.get("authorization"), null);
});
const req = (path = "orders/x", init?: RequestInit) =>
  new Request(`http://localhost/api/${path}`, init);

test("all 23 backend endpoint shapes are allowlisted with the correct method", () => {
  const posts = [
    "orders",
    "orders/x/resume",
    "payments/charge",
    "payments/refund",
    "inventory/reserve",
    "inventory/release",
    "inventory/finalize",
    "shipments/create",
    "shipments/cancel",
  ];
  const gets = [
    "orders/x",
    "orders/x/history",
    "orders/attention",
    "payments/x",
    "inventory/reservations/x",
    "shipments/x",
    ...["orders", "payment", "inventory", "shipping"].flatMap((s) => [
      `services/${s}/health`,
      `services/${s}/ready`,
    ]),
  ];
  assert.equal(posts.length + gets.length, 23);
  for (const path of posts)
    assert.equal(resolveTarget(path.split("/"))?.method, "POST", path);
  for (const path of gets)
    assert.equal(resolveTarget(path.split("/"))?.method, "GET", path);
  for (const path of [
    ["__proto__"],
    ["orders", ".."],
    ["orders", "a/b"],
    ["services", "evil", "ready"],
    ["https:", "evil"],
  ])
    assert.equal(resolveTarget(path), undefined);
});

test("configuration rejects unsafe origins and invalid deadlines", () => {
  assert.equal(config.origins.orders, "http://127.0.0.1:3000");
  for (const url of [
    "file:///tmp",
    "https://user:secret@example.com",
    "http://localhost/path",
    "http://localhost?x=1",
  ])
    assert.throws(() => parseBackendConfig({ ORDERS_SERVICE_URL: url }));
  for (const timeout of ["0", "NaN", "120001"])
    assert.throws(() => parseBackendConfig({ BACKEND_TIMEOUT_MS: timeout }));
});

test("preserves bodies, query strings, statuses and retry metadata without forwarding cookies", async () => {
  for (const status of [200, 201, 202, 400, 404, 409, 422, 503]) {
    const raw = '{ "idempotencyKey": "same-key" }';
    const response = await proxyRequest(
      req("orders?limit=5", {
        method: "POST",
        body: raw,
        headers: { "Content-Type": "application/json", Cookie: "secret=value" },
      }),
      ["orders"],
      config,
      async (url, init) => {
        assert.equal(String(url), "http://127.0.0.1:3000/orders?limit=5");
        assert.equal(new TextDecoder().decode(init!.body as Uint8Array), raw);
        assert.equal(new Headers(init!.headers).get("cookie"), null);
        assert.equal(init!.cache, "no-store");
        return Response.json(
          { status },
          {
            status,
            headers: {
              "Retry-After": "1",
              Location: "/orders/x",
              "Set-Cookie": "secret=value",
            },
          },
        );
      },
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { status });
    assert.equal(response.headers.get("Retry-After"), "1");
    assert.equal(response.headers.get("Location"), "/orders/x");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
  }
});

test("rejects unknown paths, wrong methods and oversized bodies before contacting backend", async () => {
  const never: typeof fetch = async () => {
    throw new Error("Should not fetch");
  };
  assert.equal(
    (await proxyRequest(req(), ["unknown"], config, never)).status,
    404,
  );
  const wrong = await proxyRequest(req("orders"), ["orders"], config, never);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("Allow"), "POST");
  assert.equal(
    (
      await proxyRequest(
        req("orders", { method: "POST", body: "x".repeat(32769) }),
        ["orders"],
        config,
        never,
      )
    ).status,
    413,
  );
});

test("invalid JSON, HTML and redirects become sanitized 502 errors", async () => {
  for (const response of [
    new Response("<html>oops</html>"),
    new Response("invalid", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response(null, {
      status: 302,
      headers: { Location: "https://evil.example" },
    }),
  ]) {
    assert.equal(
      (await proxyRequest(req(), ["orders", "x"], config, async () => response))
        .status,
      502,
    );
  }
});

test("unavailable, timed out and cancelled requests have distinct responses", async () => {
  const unavailable = await proxyRequest(
    req(),
    ["orders", "x"],
    config,
    async () => {
      throw new Error("secret backend hostname");
    },
  );
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /secret/);
  const timeout = await proxyRequest(
    req(),
    ["orders", "x"],
    { ...config, timeoutMs: 10 },
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () =>
          reject(new Error("abort")),
        ),
      ),
  );
  assert.equal(timeout.status, 504);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await proxyRequest(
        req("orders/x", { signal: controller.signal }),
        ["orders", "x"],
        config,
      )
    ).status,
    499,
  );
});
