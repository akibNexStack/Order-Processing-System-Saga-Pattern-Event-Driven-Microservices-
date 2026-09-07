import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { parse } from 'dotenv';
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp as paymentApp } from '../../services/payment-service/dist/app.js';
import { PaymentService } from '../../services/payment-service/dist/payments/service.js';
import { LocalPaymentProvider } from '../../services/payment-service/dist/providers/local-provider.js';
import { createApp as inventoryApp } from '../../services/inventory-service/dist/app.js';
import { InventoryService } from '../../services/inventory-service/dist/inventory/service.js';
import { createApp as shippingApp } from '../../services/shipping-service/dist/app.js';
import { ShippingService } from '../../services/shipping-service/dist/shipments/service.js';
import { LocalShippingProvider } from '../../services/shipping-service/dist/providers/local-provider.js';
import { createApp } from '../../services/order-orchestrator/dist/app.js';
import { OrderService } from '../../services/order-orchestrator/dist/orders/service.js';
import { HttpTransport } from '../../services/order-orchestrator/dist/saga/httpTransport.js';

const uncertain = c => {
  const { payload: _, ...meta } = c;
  return { ...meta, outcome: 'UNKNOWN', error: { code: 'PROVIDER_UNAVAILABLE', message: 'Injected response loss', retryable: true } };
};
const post = async (app, request) => {
  const r = await app.request('/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  return { status: r.status, location: r.headers.get('location'), body: await r.json() };
};

test('HTTP order orchestration with all service databases', async t => {
  const fixtures = [], servers = [];
  const dbs = {};
  const start = async app => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); servers.push(server);
    if (!server.listening) await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };
  try {
    for (const [name, key] of [['payment-service', 'PAYMENT'], ['inventory-service', 'INVENTORY'], ['shipping-service', 'SHIPPING'], ['order-orchestrator', 'ORDER']]) {
      const url = new URL(process.env[`TEST_${key}_DATABASE_URL`] ?? parse(readFileSync(new URL(`../../services/${name}/.env`, import.meta.url))).DATABASE_URL);
      const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
      const fixture = { admin, name: `saga_order_test_${randomUUID().replaceAll('-', '')}`, created: false }; fixtures.push(fixture);
      await admin.query(`CREATE DATABASE "${fixture.name}"`); fixture.created = true;
      url.pathname = `/${fixture.name}`;
      fixture.pool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
      fixture.providerPool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
      dbs[key] = fixture;
      await migrate(drizzle(fixture.pool), { migrationsFolder: fileURLToPath(new URL(`../../services/${name}/drizzle/`, import.meta.url)) });
    }
    const p = paymentApp(new PaymentService(dbs.PAYMENT.pool, new LocalPaymentProvider(dbs.PAYMENT.providerPool)));
    const i = inventoryApp(new InventoryService(dbs.INVENTORY.pool));
    const s = shippingApp(new ShippingService(dbs.SHIPPING.pool, new LocalShippingProvider(dbs.SHIPPING.providerPool)));
    const urls = { payment: await start(p), inventory: await start(i), shipping: await start(s) };
    const transport = new HttpTransport(urls, 3000);
    const service = new OrderService(dbs.ORDER.pool, transport);
    const app = createApp(service);
    const request = async (stock = 10) => {
      const productId = randomUUID();
      await dbs.INVENTORY.pool.query('INSERT INTO products(id,sku,name,available_stock) VALUES ($1,$2,\'Order test product\',$3)', [productId, productId, stock]);
      return { idempotencyKey: randomUUID(), payload: { customerId: randomUUID(), items: [{ productId, quantity: 2 }], amountMinor: 12500, currency: 'BDT',
        shippingAddress: { recipient: 'Test Customer', line1: '10 Test Road', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' } } };
    };
    const row = async (key, table, id) => (await dbs[key].pool.query(`SELECT * FROM ${table} WHERE order_id=$1`, [id])).rows[0];

    await t.test('invalid input and unknown IDs are rejected without creating orders', async () => {
      assert.equal((await post(app, { idempotencyKey: 'bad', payload: {} })).status, 400);
      assert.equal((await app.request('/orders', { method: 'POST', body: '{}' })).status, 415);
      assert.equal((await app.request('/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
      assert.equal((await app.request('/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(40000) })).status, 413);
      assert.equal((await app.request('/orders/bad')).status, 400);
      assert.equal((await app.request(`/orders/${randomUUID()}`)).status, 404);
      assert.equal((await app.request(`/orders/${randomUUID()}/resume`, { method: 'POST' })).status, 404);
      assert.equal((await dbs.ORDER.pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 0);
    });
    await t.test('happy path persists intent before calls and completes after inventory finalization', async () => {
      const commands = [];
      const traced = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => {
        commands.push(c.operation);
        const saga = await row('ORDER', 'saga_instances', c.orderId);
        assert.equal(saga.current_operation, c.operation);
        assert.ok(saga.version >= 2);
        assert.equal((await dbs.ORDER.pool.query('SELECT count(*)::int AS n FROM order_items WHERE order_id=$1', [c.orderId])).rows[0].n, 1);
        return transport.execute(c);
      } }));
      const r = await post(traced, await request());
      assert.equal(r.status, 201); assert.equal(r.body.saga.status, 'COMPLETED');
      assert.deepEqual(commands, ['CHARGE_PAYMENT', 'RESERVE_INVENTORY', 'CREATE_SHIPMENT', 'FINALIZE_INVENTORY']);
      assert.deepEqual(r.body.saga.completedSteps, ['PAYMENT', 'INVENTORY', 'SHIPPING']);
      assert.equal(r.body.saga.inventoryFinalized, true);
      assert.equal((await row('PAYMENT', 'payments', r.body.order.id)).status, 'CHARGED');
      assert.equal((await row('SHIPPING', 'shipments', r.body.order.id)).status, 'CREATED');
      assert.equal((await row('INVENTORY', 'reservations', r.body.order.id)).status, 'FINALIZED');
      assert.deepEqual(r.body.transitions.map(x => x.sequence), Array.from({ length: 9 }, (_, n) => n + 1));
      const read = await app.request(r.location); assert.equal(read.status, 200);
      assert.equal((await read.json()).saga.status, 'COMPLETED');
    });
    await t.test('duplicate/concurrent customer requests create one order and one saga', async () => {
      const req = await request();
      const other = createApp(new OrderService(dbs.ORDER.pool, new HttpTransport(urls)));
      const responses = await Promise.all(Array.from({ length: 12 }, (_, n) => post(n % 2 ? app : other, req)));
      assert.ok(responses.every(r => [200, 201, 202].includes(r.status)));
      assert.equal(new Set(responses.map(r => r.body.order.id)).size, 1);
      const final = await post(app, req); assert.equal(final.status, 200);
      assert.equal(final.body.saga.status, 'COMPLETED');
      assert.equal(final.body.saga.attempts, 4);
      assert.equal(final.body.transitions.filter(r => r.details.event === 'STEP_SUCCEEDED').length, 3);
    });
    await t.test('changed payload conflicts; customer-scoped keys and normalized input work', async () => {
      const req = await request(); const first = await post(app, req);
      assert.equal((await post(app, { ...req, payload: { ...req.payload, amountMinor: 999 } })).status, 409);
      const normalized = { ...req, payload: { ...req.payload, customerId: req.payload.customerId.toUpperCase(), items: req.payload.items.map(x => ({ ...x, productId: x.productId.toUpperCase() })), shippingAddress: { ...req.payload.shippingAddress, city: ' Dhaka ' } } };
      assert.equal((await post(app, normalized)).body.order.id, first.body.order.id);
      const other = await post(app, { ...req, payload: { ...req.payload, customerId: randomUUID() } });
      assert.equal(other.status, 201); assert.notEqual(other.body.order.id, first.body.order.id);
    });
    await t.test('order/items/saga/history insertion rolls back together', async () => {
      const req = await request();
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_history BEFORE INSERT ON saga_transitions FOR EACH ROW EXECUTE FUNCTION reject_history()');
      try { assert.equal((await post(app, req)).status, 503); }
      finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_history ON saga_transitions'); await dbs.ORDER.pool.query('DROP FUNCTION reject_history()'); }
      assert.equal((await dbs.ORDER.pool.query('SELECT count(*)::int AS n FROM orders WHERE idempotency_key=$1', [req.idempotencyKey])).rows[0].n, 0);
      assert.equal((await post(app, req)).status, 201);
    });
    await t.test('lost payment response resumes without duplicating payment', async () => {
      const lossy = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => {
        const result = await transport.execute(c);
        return c.operation === 'CHARGE_PAYMENT' ? uncertain(c) : result;
      } }));
      const req = await request(); const first = await post(lossy, req);
      assert.equal(first.status, 202); assert.deepEqual(first.body.saga.completedSteps, []);
      assert.equal((await row('PAYMENT', 'payments', first.body.order.id)).status, 'CHARGED');
      const restarted = createApp(new OrderService(dbs.ORDER.pool, new HttpTransport(urls)));
      const resumed = await restarted.request(`/orders/${first.body.order.id}/resume`, { method: 'POST' });
      assert.equal(resumed.status, 200);
      assert.equal((await dbs.PAYMENT.pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [first.body.order.id])).rows[0].n, 1);
    });
    await t.test('failed transition after remote success rolls back history and resumes safely', async () => {
      const req = await request();
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_progress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF jsonb_array_length(NEW.completed_steps) > jsonb_array_length(OLD.completed_steps) THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_progress BEFORE UPDATE ON saga_instances FOR EACH ROW EXECUTE FUNCTION reject_progress()');
      let failed;
      try { failed = await post(app, req); assert.equal(failed.status, 503); }
      finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_progress ON saga_instances'); await dbs.ORDER.pool.query('DROP FUNCTION reject_progress()'); }
      const before = await (await app.request(failed.location)).json();
      assert.equal(before.saga.currentOperation, 'CHARGE_PAYMENT'); assert.equal(before.transitions.length, 2);
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
      assert.equal((await dbs.PAYMENT.pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [before.order.id])).rows[0].n, 1);
    });
    await t.test('payment decline fails with no downstream work', async () => {
      const rejectUrl = await start(paymentApp(new PaymentService(dbs.PAYMENT.pool, new LocalPaymentProvider(dbs.PAYMENT.providerPool, 'reject'))));
      const failing = createApp(new OrderService(dbs.ORDER.pool, new HttpTransport({ ...urls, payment: rejectUrl })));
      const req = await request(); const result = await post(failing, req);
      assert.equal(result.status, 422); assert.equal(result.body.saga.status, 'FAILED');
      assert.deepEqual(result.body.saga.completedSteps, []);
      assert.equal(await row('INVENTORY', 'reservations', result.body.order.id), undefined);
      assert.equal((await post(app, req)).status, 422);
    });
    await t.test('inventory failure records required compensation and does not ship', async () => {
      const result = await post(app, await request(0));
      assert.equal(result.status, 202); assert.equal(result.body.saga.status, 'COMPENSATING');
      assert.equal(result.body.requiresCompensation, true);
      assert.deepEqual(result.body.saga.completedSteps, ['PAYMENT']);
      assert.equal(await row('SHIPPING', 'shipments', result.body.order.id), undefined);
      assert.equal((await row('PAYMENT', 'payments', result.body.order.id)).status, 'CHARGED');
      const resumed = await app.request(`/orders/${result.body.order.id}/resume`, { method: 'POST' });
      assert.equal((await resumed.json()).saga.status, 'COMPENSATING');
    });
    await t.test('shipping rejection preserves completed steps for Part 7 compensation', async () => {
      const rejectUrl = await start(shippingApp(new ShippingService(dbs.SHIPPING.pool, new LocalShippingProvider(dbs.SHIPPING.providerPool, 'reject'))));
      const failing = createApp(new OrderService(dbs.ORDER.pool, new HttpTransport({ ...urls, shipping: rejectUrl })));
      const result = await post(failing, await request());
      assert.equal(result.body.saga.status, 'COMPENSATING');
      assert.deepEqual(result.body.saga.completedSteps, ['PAYMENT', 'INVENTORY']);
      assert.equal((await row('INVENTORY', 'reservations', result.body.order.id)).status, 'RESERVED');
    });
    await t.test('finalization response loss and completion write failure never trigger compensation', async () => {
      const lossy = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => {
        const result = await transport.execute(c); return c.operation === 'FINALIZE_INVENTORY' ? uncertain(c) : result;
      } }));
      const req = await request(); const first = await post(lossy, req);
      assert.equal(first.body.saga.currentOperation, 'FINALIZE_INVENTORY'); assert.equal(first.body.saga.status, 'IN_PROGRESS');
      assert.equal((await row('INVENTORY', 'reservations', first.body.order.id)).status, 'FINALIZED');
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='COMPLETED' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_complete BEFORE UPDATE ON saga_instances FOR EACH ROW EXECUTE FUNCTION reject_complete()');
      try { assert.equal((await post(app, req)).status, 503); }
      finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_complete ON saga_instances'); await dbs.ORDER.pool.query('DROP FUNCTION reject_complete()'); }
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
    });
    await t.test('resume continues at shipping rather than replaying earlier stages', async () => {
      const calls = [];
      const interrupted = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => {
        const result = await transport.execute(c); return c.operation === 'CREATE_SHIPMENT' ? uncertain(c) : result;
      } }));
      const req = await request(); const first = await post(interrupted, req);
      assert.deepEqual(first.body.saga.completedSteps, ['PAYMENT', 'INVENTORY']);
      assert.equal(first.body.saga.currentOperation, 'CREATE_SHIPMENT');
      const resumed = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => { calls.push(c.operation); return transport.execute(c); } }));
      assert.equal((await post(resumed, req)).body.saga.status, 'COMPLETED');
      assert.deepEqual(calls, ['CREATE_SHIPMENT', 'FINALIZE_INVENTORY']);
    });
    await t.test('finalization rejection requires reconciliation instead of compensation', async () => {
      const failing = createApp(new OrderService(dbs.ORDER.pool, { execute: async c => {
        if (c.operation !== 'FINALIZE_INVENTORY') return transport.execute(c);
        const { payload: _, ...metadata } = c;
        return { ...metadata, outcome: 'FAILED', error: { code: 'INVALID_STATE', message: 'Injected finalization rejection', retryable: false } };
      } }));
      const req = await request(); const first = await post(failing, req);
      assert.equal(first.body.saga.status, 'IN_PROGRESS');
      assert.equal(first.body.requiresCompensation, false);
      assert.equal(first.body.saga.currentOperation, 'FINALIZE_INVENTORY');
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
    });
    await t.test('malformed and mismatched HTTP results stay retryable', async () => {
      const bad = await start({ fetch: async r => {
        const c = await r.json(); const result = await transport.execute(c);
        return Response.json({ ...result, orderId: randomUUID() });
      } });
      const req = await request(); const result = await post(createApp(new OrderService(dbs.ORDER.pool, new HttpTransport({ ...urls, payment: bad }))), req);
      assert.equal(result.status, 202); assert.equal(result.body.saga.currentStep, 'PAYMENT');
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
      const malformed = await start({ fetch: () => new Response('not json', { status: 503 }) });
      const pending = await post(createApp(new OrderService(dbs.ORDER.pool, new HttpTransport({ ...urls, payment: malformed }))), await request());
      assert.equal(pending.body.saga.status, 'IN_PROGRESS');
    });
    await t.test('HTTP timeout leaves a durable retryable intent', async () => {
      const slow = await start({ fetch: async () => { await new Promise(r => setTimeout(r, 80)); return Response.json({}); } });
      const req = await request(); const result = await post(createApp(new OrderService(dbs.ORDER.pool, new HttpTransport({ ...urls, payment: slow }, 5))), req);
      assert.equal(result.status, 202); assert.equal(result.body.saga.lastResult.outcome, 'UNKNOWN');
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
    });
    await t.test('inconsistent persisted progress cannot skip payment or inventory', async () => {
      const req = await request(); const accepted = await service.accept(req);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET current_operation='CREATE_SHIPMENT',current_step='SHIPPING' WHERE order_id=$1", [accepted.orderId]);
      assert.equal((await app.request(`/orders/${accepted.orderId}/resume`, { method: 'POST' })).status, 503);
      assert.equal(await row('SHIPPING', 'shipments', accepted.orderId), undefined);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET current_operation='CHARGE_PAYMENT',current_step='PAYMENT' WHERE order_id=$1", [accepted.orderId]);
      assert.equal((await post(app, req)).body.saga.status, 'COMPLETED');
    });
    await t.test('real HTTP order endpoint completes through three HTTP participant services', async () => {
      const base = await start(app);
      const response = await fetch(`${base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await request()) });
      assert.equal(response.status, 201);
      const status = await fetch(new URL(response.headers.get('location'), base));
      assert.equal((await status.json()).saga.status, 'COMPLETED');
    });
  } finally {
    for (const server of servers.reverse()) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const fixture of fixtures.reverse()) {
      await fixture.pool?.end(); await fixture.providerPool?.end();
      if (fixture.created) await fixture.admin.query(`DROP DATABASE "${fixture.name}"`);
      await fixture.admin.end();
    }
  }
});
