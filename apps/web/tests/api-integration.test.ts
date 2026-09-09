import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { makeStore } from "../src/lib/store";
import { sagaApi } from "../src/lib/api/api";
import { chromium, expect } from "@playwright/test";
import {
  fillCheckout,
  orderReply,
  orderId,
  payload,
} from "./fixtures/checkout";

test(
  "production Next route and RTK Query integrate with isolated HTTP backends",
  { timeout: 60000 },
  async (t) => {
    let mode = "normal";
    let calls = 0;
    let received = "";
    let resumed = false;
    let resumeRequests = 0;
    const orderRequests: string[] = [];
    const backend = createServer(async (req, res) => {
      calls++;
      let requestBody = "";
      for await (const chunk of req) requestBody += chunk.toString();
      received = requestBody;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Retry-After", "2");
      if (mode === "timeout") {
        return;
      }
      if (mode === "html") {
        res.setHeader("Content-Type", "text/html");
        res.end("oops");
        return;
      }
      if (mode === "invalid") {
        res.end(JSON.stringify({ invalid: true }));
        return;
      }
      if (req.url === "/orders" && req.method === "POST") {
        orderRequests.push(requestBody);
        if (orderRequests.length === 1) {
          res.statusCode = 503;
          res.setHeader("Retry-After", "0");
          res.end(
            JSON.stringify({
              error: "Saved but reply unavailable; retry original key",
            }),
          );
        } else {
          res.statusCode = 202;
          res.setHeader("Location", `/orders/${orderId}`);
          res.end(JSON.stringify(orderReply(JSON.parse(requestBody))));
        }
        return;
      }
      if (req.url === `/orders/${orderId}` && orderRequests.length) {
        const state = orderReply(JSON.parse(orderRequests.at(-1)!));
        if (resumed) { state.saga.status = "COMPLETED"; state.saga.version = 2; }
        res.end(JSON.stringify(state));
        return;
      }
      if (req.url === `/orders/${orderId}/resume` && req.method === "POST") {
        resumed = true;
        resumeRequests++;
        const state = orderReply(JSON.parse(orderRequests.at(-1)!));
        state.saga.status = "COMPLETED";
        state.saga.version = 2;
        res.end(JSON.stringify(state));
        return;
      }
      if (req.url === `/orders/${orderId}/history` && orderRequests.length) {
        res.end(JSON.stringify({
          orderId, status: "IN_PROGRESS", interventionReason: null,
          history: [{
            sequence: 1, at: "2026-09-09T06:00:00.000Z", step: "PAYMENT",
            direction: "FORWARD", from: null, to: "IN_PROGRESS",
            event: "ORDER_ACCEPTED", summary: "Saga: order accepted (payment)",
          }],
        }));
        return;
      }
      const missingName =
        req.url === `/payments/${orderId}`
          ? "Payment"
          : req.url === `/inventory/reservations/${orderId}`
            ? "Reservation"
            : req.url === `/shipments/${orderId}`
              ? "Shipment"
              : null;
      if (missingName) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `${missingName} not found` }));
        return;
      }
      if (req.url === "/ready") {
        res.statusCode = 503;
        res.end(
          JSON.stringify({
            status: "not_ready",
            checks: { database: true, broker: false },
          }),
        );
        return;
      }
      if (req.url === "/health") {
        res.end(
          JSON.stringify({ service: "order-orchestrator", status: "ok" }),
        );
        return;
      }
      if (req.url?.startsWith("/orders/attention")) {
        res.end(JSON.stringify({ limit: 100, orders: orderRequests.length && !resumed ? [{
          orderId, sagaId: orderReply(JSON.parse(orderRequests.at(-1)!)).saga.id,
          status: "IN_PROGRESS", operation: "CHARGE_PAYMENT", reason: "COMMAND_RETRIES_EXHAUSTED",
          updatedAt: "2026-09-09T06:00:00.000Z",
        }] : [] }));
        return;
      }
      if (req.url === "/payments/charge") {
        res.statusCode = 422;
        res.end(
          JSON.stringify({
            ...JSON.parse(received),
            payload: undefined,
            outcome: "FAILED",
            error: {
              code: "PAYMENT_DECLINED",
              message: "Declined",
              retryable: false,
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Order not found" }));
    });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const address = backend.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const next = spawn(
      process.execPath,
      [
        "../../node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3105",
      ],
      {
        env: {
          ...process.env,
          ORDERS_SERVICE_URL: origin,
          PAYMENT_SERVICE_URL: origin,
          INVENTORY_SERVICE_URL: origin,
          SHIPPING_SERVICE_URL: origin,
          // Allow the screen's parallel burst; timeout mode below still proves 504 handling.
          BACKEND_TIMEOUT_MS: "1000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    next.stdout.on("data", (c) => {
      output += c;
    });
    next.stderr.on("data", (c) => {
      output += c;
    });
    const NativeRequest = globalThis.Request;
    const store = makeStore();
    t.after(async () => {
      globalThis.Request = NativeRequest;
      store.dispatch(sagaApi.util.resetApiState());
      next.kill("SIGTERM");
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      if (next.exitCode === null && next.signalCode === null)
        await once(next, "exit");
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (next.exitCode !== null) throw new Error(output);
      try {
        if ((await fetch("http://127.0.0.1:3105")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, output);
    // Node lacks a browser's base URL; resolve relative Requests against the real Next server.
    globalThis.Request = class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string" && input.startsWith("/")
            ? `http://127.0.0.1:3105${input}`
            : input,
          init,
        );
      }
    };
    const health = await store
      .dispatch(sagaApi.endpoints.getServiceHealth.initiate("orders"))
      .unwrap();
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    const before = calls;
    await store
      .dispatch(sagaApi.endpoints.getServiceHealth.initiate("orders"))
      .unwrap();
    assert.equal(calls, before + 1, "New subscriptions refresh live data");
    await store
      .dispatch(
        sagaApi.endpoints.getServiceHealth.initiate("orders", {
          forceRefetch: false,
        }),
      )
      .unwrap();
    assert.equal(calls, before + 1, "Explicit cache reads reuse RTK data");
    const readiness = await store
      .dispatch(sagaApi.endpoints.getServiceReadiness.initiate("orders"))
      .unwrap();
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.status, "not_ready");
    assert.equal(readiness.retryAfter, "2");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto("http://127.0.0.1:3105");
      const responses = await page.evaluate(async () =>
        Promise.all(
          ["orders", "payment", "inventory", "shipping"].map(
            async (service) => {
              const response = await fetch(`/api/services/${service}/health`);
              return {
                status: response.status,
                cache: response.headers.get("Cache-Control"),
                body: await response.json(),
              };
            },
          ),
        ),
      );
      for (const response of responses) {
        assert.equal(response.status, 200);
        assert.equal(response.body.status, "ok");
        assert.match(response.cache!, /no-store/);
      }
      // Exercise the actual screen -> RTK hooks -> Next proxy -> HTTP backend chain.
      await page.goto("http://127.0.0.1:3105/services");
      const orderCard = page.getByRole("region", {
        name: "Order Orchestrator",
        exact: true,
      });
      await expect(
        orderCard.getByText("Responding", { exact: true }),
      ).toBeVisible();
      await expect(
        orderCard.getByText("Not ready", { exact: true }),
      ).toBeVisible();
      await expect(
        orderCard.getByText("Order recovery", { exact: true }),
      ).toBeVisible();
      // Real browser -> RTK mutation -> production Next POST proxy -> HTTP fixture.
      await page.goto("http://127.0.0.1:3105/orders/new");
      await fillCheckout(page);
      await page
        .getByRole("button", { name: "Create order", exact: true })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Order service unavailable (503)",
      );
      await page
        .getByRole("button", { name: "Retry original request" })
        .click();
      await expect(page).toHaveURL(`http://127.0.0.1:3105/orders/${orderId}`);
      await expect(
        page
          .getByRole("region", { name: "Submission receipt", exact: true })
          .getByRole("status"),
      ).toContainText("Processing is not complete");
      assert.equal(orderRequests.length, 2);
      assert.equal(orderRequests[0], orderRequests[1]);
      assert.deepEqual(JSON.parse(orderRequests[0]).payload, payload);
      await expect(
        page.getByRole("region", { name: "Order overview", exact: true }),
      ).toContainText("CHARGE_PAYMENT");
      await expect(page.getByRole("region", { name: "Saga progress" })
        .getByRole("listitem").first()).toContainText("Running");
      await expect(page.getByRole("region", { name: "Order history" }))
        .toContainText("The order was accepted and processing began.");
      for (const name of ["Payment", "Reservation", "Shipment"])
        await expect(
          page.getByRole("region", { name, exact: true }),
        ).toContainText("Not started yet");
      await page.goto("http://127.0.0.1:3105/attention");
      await expect(page.getByRole("region", { name: "Orders requiring attention" })).toContainText("COMMAND_RETRIES_EXHAUSTED");
      await page.getByRole("link", { name: "Open order", exact: true }).click();
      await page.getByRole("button", { name: "Resume order", exact: true }).click();
      await expect(page.getByRole("region", { name: "Order overview" })).toContainText("COMPLETED");
      await expect(page.getByRole("button", { name: "Resume order", exact: true })).toHaveCount(0);
      assert.equal(resumeRequests, 1);
      await page.goto("http://127.0.0.1:3105/");
      await expect(page.getByRole("region", { name: "Orders requiring attention" })).toContainText("No orders requiring attention were returned");
      await expect(page.getByRole("region", { name: "Recent orders" })).toContainText(orderId);
    } finally {
      await browser.close();
    }
    const missing = await store.dispatch(
      sagaApi.endpoints.getOrder.initiate(
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    assert.ok(missing.error && "status" in missing.error);
    assert.equal(missing.error.status, 404);
    const body = {
      version: 1 as const,
      operation: "CHARGE_PAYMENT" as const,
      orderId: "11111111-1111-4111-8111-111111111111",
      sagaId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "original-key",
      payload: {
        customerId: "33333333-3333-4333-8333-333333333333",
        amountMinor: 100,
        currency: "USD" as const,
      },
    };
    const charged = await store
      .dispatch(sagaApi.endpoints.chargePayment.initiate(body))
      .unwrap();
    assert.equal(charged.status, 422);
    assert.equal(charged.body.outcome, "FAILED");
    assert.deepEqual(JSON.parse(received), body);
    mode = "invalid";
    const invalid = await store.dispatch(
      sagaApi.endpoints.getServiceHealth.initiate("payment"),
    );
    assert.ok(invalid.error && "status" in invalid.error);
    assert.equal(invalid.error.status, "INVALID_RESPONSE");
    mode = "html";
    assert.equal(
      (await fetch("http://127.0.0.1:3105/api/services/shipping/health"))
        .status,
      502,
    );
    mode = "timeout";
    assert.equal(
      (await fetch("http://127.0.0.1:3105/api/services/inventory/health"))
        .status,
      504,
    );
    mode = "normal";
    assert.equal((await fetch("http://127.0.0.1:3105/api/orders")).status, 405);
    assert.equal(
      (await fetch("http://127.0.0.1:3105/api/unknown")).status,
      404,
    );
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    assert.equal(
      (await fetch("http://127.0.0.1:3105/api/services/orders/health")).status,
      503,
    );
  },
);
