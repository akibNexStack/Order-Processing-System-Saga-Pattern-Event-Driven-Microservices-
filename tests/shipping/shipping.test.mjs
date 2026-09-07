import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from '../../services/shipping-service/dist/app.js';
import { ShippingService } from '../../services/shipping-service/dist/shipments/service.js';
import { LocalShippingProvider } from '../../services/shipping-service/dist/providers/local-provider.js';
import { ResultSchema } from '../../shared/dist/index.js';

const create = () => ({ version: 1, operation: 'CREATE_SHIPMENT', orderId: randomUUID(), sagaId: randomUUID(), idempotencyKey: randomUUID(), payload: {
  items: [{ productId: randomUUID(), quantity: 2 }, { productId: randomUUID(), quantity: 1 }],
  shippingAddress: { recipient: 'Test Customer', line1: '10 Test Road', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' },
} });
const cancellation = (c) => ({ ...c, operation: 'CANCEL_SHIPMENT', idempotencyKey: randomUUID(), payload: {} });
const send = async (app, c) => {
  const response = await app.request(`/shipments/${c.operation === 'CREATE_SHIPMENT' ? 'create' : 'cancel'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
  const body = await response.json();
  if ([200, 202, 409, 422].includes(response.status)) ResultSchema.parse(body);
  return { status: response.status, body };
};

test('Shipping Service HTTP handlers with real PostgreSQL and durable provider', async (t) => {
  const url = new URL(process.env.TEST_SHIPPING_DATABASE_URL ?? parse(readFileSync(new URL('../../services/shipping-service/.env', import.meta.url))).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  const name = `saga_shipment_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  let pool, providerPool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    providerPool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../services/shipping-service/drizzle/', import.meta.url)) });
    const provider = new LocalShippingProvider(providerPool);
    const app = createApp(new ShippingService(pool, provider));
    const shipment = async c => (await pool.query('SELECT * FROM shipments WHERE order_id=$1', [c.orderId])).rows[0];

    await t.test('rejects malformed commands before database or provider writes', async () => {
      const before = (await pool.query('SELECT count(*) FROM shipments')).rows[0].count;
      for (const body of ['{', JSON.stringify({ ...create(), payload: { items: [] } }), JSON.stringify({ ...create(), forceFailure: true })]) {
        const response = await app.request('/shipments/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        assert.equal(response.status, 400);
      }
      assert.equal((await app.request('/shipments/create', { method: 'POST', body: '{}' })).status, 415);
      assert.equal((await app.request('/shipments/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(40000) })).status, 413);
      assert.equal((await pool.query('SELECT count(*) FROM shipments')).rows[0].count, before);
      assert.equal((await app.request('/shipments/not-a-uuid')).status, 400);
      assert.equal((await app.request(`/shipments/${randomUUID()}`)).status, 404);
    });
    await t.test('creates, reports status, cancels, and replays historical results', async () => {
      const c = create();
      const first = await send(app, c);
      assert.equal(first.status, 200);
      assert.equal(first.body.data.status, 'CREATED');
      assert.deepEqual(await send(app, c), first);
      const status = await (await app.request(`/shipments/${c.orderId}`)).json();
      assert.equal(status.shipment.items.length, 2);
      assert.equal(status.shipment.status, 'CREATED');
      const r = cancellation(c);
      const reversed = await send(app, r);
      assert.equal(reversed.body.data.status, 'CANCELLED');
      assert.deepEqual(await send(app, r), reversed);
      assert.deepEqual(await send(app, c), first);
      assert.equal((await shipment(c)).status, 'CANCELLED');
      assert.equal((await send(app, { ...c, idempotencyKey: randomUUID() })).body.error.code, 'ALREADY_COMPENSATED');
    });
    await t.test('concurrent duplicate creates and cancellations produce one provider effect each', async () => {
      const c = create();
      const results = await Promise.all(Array.from({ length: 20 }, () => send(app, c)));
      assert.ok(results.every(r => [200, 202].includes(r.status)));
      const expected = await send(app, c);
      assert.equal(expected.status, 200);
      for (const result of results.filter(r => r.status === 200)) assert.deepEqual(result, expected);
      const r = cancellation(c);
      const reversed = await Promise.all(Array.from({ length: 20 }, () => send(app, r)));
      assert.ok(reversed.every(r => [200, 202].includes(r.status)));
      assert.equal((await send(app, r)).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 2);
    });
    await t.test('rejects changed payloads, changed saga ownership, and reused keys across orders', async () => {
      const c = create(); await send(app, c);
      for (const changed of [
        { ...c, payload: { ...c.payload, shippingAddress: { ...c.payload.shippingAddress, city: 'Different city' } } },
        { ...c, idempotencyKey: randomUUID(), payload: { ...c.payload, items: [{ ...c.payload.items[0], quantity: 9 }] } },
        { ...c, idempotencyKey: randomUUID(), sagaId: randomUUID() },
        { ...c, orderId: randomUUID() },
        { ...cancellation(c), sagaId: randomUUID() },
      ]) assert.equal((await send(app, changed)).body.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await shipment(c)).status, 'CREATED');
    });
    await t.test('different client keys reuse the stable provider key', async () => {
      const c = create(); const first = await send(app, c);
      const other = await send(app, { ...c, idempotencyKey: randomUUID() });
      assert.equal(other.body.data.providerShipmentId, first.body.data.providerShipmentId);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 1);
    });
    await t.test('cancellation before create is a durable no-op and blocks delayed creates', async () => {
      const c = create(); const r = cancellation(c);
      assert.equal((await send(app, r)).body.data.status, 'NOOP');
      const recreated = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool)));
      assert.equal((await send(recreated, c)).body.error.code, 'ALREADY_COMPENSATED');
      const status = await (await recreated.request(`/shipments/${c.orderId}`)).json();
      assert.equal(status.shipment, null);
      assert.equal(status.cancellation.status, 'NOOP');
    });
    await t.test('provider decline is saved and cancellations safely do nothing', async () => {
      const failing = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool, 'reject')));
      const c = create(); const result = await send(failing, c);
      assert.equal(result.status, 422);
      assert.deepEqual(await send(app, c), result);
      assert.equal((await shipment(c)).status, 'FAILED');
      assert.equal((await send(app, cancellation(c))).body.data.status, 'NOOP');
    });
    await t.test('lost create and cancellation responses reconcile after recreating provider and service', async () => {
      const flaky = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool, 'timeout-after-success')));
      const c = create();
      assert.equal((await send(flaky, c)).status, 202);
      assert.equal((await shipment(c)).status, 'PENDING');
      const restarted = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool)));
      assert.equal((await send(restarted, c)).status, 200);
      const r = cancellation(c);
      assert.equal((await send(flaky, r)).status, 202);
      assert.equal((await shipment(c)).status, 'CREATED');
      assert.equal((await send(restarted, r)).body.data.status, 'CANCELLED');
      assert.equal((await shipment(c)).status, 'CANCELLED');
    });
    await t.test('cancellation reconciles an uncertain create before compensating it', async () => {
      const flaky = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool, 'timeout-after-success')));
      const c = create(); await send(flaky, c);
      const r = cancellation(c);
      assert.equal((await send(app, r)).body.data.status, 'CANCELLED');
      assert.equal((await shipment(c)).status, 'CANCELLED');
    });
    await t.test('provider exceptions, wrong correlation, and deadlines remain pending', async () => {
      const brokenProviders = [
        { create: async () => { throw new Error('offline'); }, cancel: provider.cancel.bind(provider) },
        { create: async c => ({ ...(await provider.create(c)), orderId: randomUUID() }), cancel: provider.cancel.bind(provider) },
        { create: async () => new Promise(() => {}), cancel: provider.cancel.bind(provider) },
      ];
      for (const broken of brokenProviders) {
        const c = create(); const brokenApp = createApp(new ShippingService(pool, broken, 25));
        assert.equal((await send(brokenApp, c)).status, 202);
        assert.equal((await shipment(c)).status, 'PENDING');
        assert.equal((await send(app, c)).status, 200);
      }
    });
    await t.test('cancellation stays pending while original creation cannot be reconciled', async () => {
      const c = create(); const r = cancellation(c);
      const unavailable = createApp(new ShippingService(pool, {
        create: async () => { throw new Error('carrier unavailable'); },
        cancel: provider.cancel.bind(provider),
      }));
      assert.equal((await send(unavailable, c)).status, 202);
      assert.equal((await send(unavailable, r)).status, 202);
      assert.equal((await shipment(c)).status, 'PENDING');
      assert.equal((await pool.query('SELECT status FROM shipment_cancellations WHERE order_id=$1', [c.orderId])).rows[0].status, 'PENDING');
      assert.equal((await send(app, r)).body.data.status, 'CANCELLED');
      assert.equal((await shipment(c)).status, 'CANCELLED');
    });
    await t.test('invalid address and item collections cannot create shipments', async () => {
      const c = create();
      for (const payload of [
        { ...c.payload, shippingAddress: { ...c.payload.shippingAddress, line1: ' ' } },
        { ...c.payload, shippingAddress: { ...c.payload.shippingAddress, countryCode: 'bd' } },
        { ...c.payload, items: [] },
        { ...c.payload, items: [c.payload.items[0], c.payload.items[0]] },
        { ...c.payload, items: [{ ...c.payload.items[0], quantity: 0.5 }] },
      ]) assert.equal((await send(app, { ...c, payload })).status, 400);
      assert.equal(await shipment(c), undefined);
    });
    await t.test('database failure after provider commit retries without a second create', async () => {
      const c = create();
      await pool.query(`CREATE FUNCTION fail_shipment_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
      await pool.query('CREATE TRIGGER fail_update BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION fail_shipment_update()');
      try { assert.equal((await send(app, c)).status, 503); }
      finally { await pool.query('DROP TRIGGER fail_update ON shipments'); await pool.query('DROP FUNCTION fail_shipment_update()'); }
      assert.equal((await shipment(c)).status, 'PENDING');
      const recreated = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool)));
      assert.equal((await send(recreated, c)).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 1);
    });
    await t.test('failed cancellation remains pending until a later successful attempt', async () => {
      const c = create(); await send(app, c); const r = cancellation(c);
      const failingCancellation = createApp(new ShippingService(pool, {
        create: provider.create.bind(provider),
        cancel: async cmd => {
          const { payload: _, ...metadata } = cmd;
          return { ...metadata, outcome: 'FAILED', error: { code: 'INVALID_STATE', message: 'Injected cancellation rejection', retryable: false } };
        },
      }));
      assert.equal((await send(failingCancellation, r)).status, 409);
      assert.equal((await shipment(c)).status, 'CREATED');
      assert.equal((await pool.query('SELECT status FROM shipment_cancellations WHERE order_id=$1', [c.orderId])).rows[0].status, 'PENDING');
      assert.equal((await send(app, r)).body.data.status, 'CANCELLED');
      assert.equal((await shipment(c)).status, 'CANCELLED');
    });
    await t.test('cancellation finalization failure rolls back local state and safely retries', async () => {
      const c = create(); await send(app, c); const r = cancellation(c);
      await pool.query(`CREATE FUNCTION fail_cancellation_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
      await pool.query('CREATE TRIGGER fail_cancellation BEFORE UPDATE ON shipment_cancellations FOR EACH ROW EXECUTE FUNCTION fail_cancellation_update()');
      try { assert.equal((await send(app, r)).status, 503); }
      finally { await pool.query('DROP TRIGGER fail_cancellation ON shipment_cancellations'); await pool.query('DROP FUNCTION fail_cancellation_update()'); }
      assert.equal((await shipment(c)).status, 'CREATED');
      assert.equal((await send(app, r)).body.data.status, 'CANCELLED');
      assert.equal((await shipment(c)).status, 'CANCELLED');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 2);
    });
    await t.test('UUID case, item order and address whitespace normalize consistently', async () => {
      const c = create();
      const first = await send(app, c);
      const normalized = { ...c, orderId: c.orderId.toUpperCase(), sagaId: c.sagaId.toUpperCase(), payload: {
        items: [...c.payload.items].reverse().map(item => ({ ...item, productId: item.productId.toUpperCase() })),
        shippingAddress: { ...c.payload.shippingAddress, city: ' Dhaka ' },
      } };
      assert.deepEqual(await send(app, normalized), first);
      assert.equal((await send(app, { ...normalized, idempotencyKey: randomUUID() })).body.data.providerShipmentId, first.body.data.providerShipmentId);
    });
    await t.test('late provider response cannot recreate a cancelled shipment', async () => {
      const c = create(); let pending;
      const delayed = { create: cmd => {
        pending = new Promise(resolve => setTimeout(resolve, 80)).then(() => provider.create(cmd));
        return pending;
      }, cancel: provider.cancel.bind(provider) };
      const slow = createApp(new ShippingService(pool, delayed, 5));
      assert.equal((await send(slow, c)).status, 202);
      assert.equal((await send(app, cancellation(c))).body.data.status, 'CANCELLED');
      await pending;
      assert.equal((await shipment(c)).status, 'CANCELLED');
      assert.equal((await pool.query('SELECT status FROM simulated_provider_shipments WHERE order_id=$1', [c.orderId])).rows[0].status, 'CANCELLED');
    });
    await t.test('serves health, create, status and cancellation over a real HTTP socket', async () => {
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      try {
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await fetch(`${base}/health`)).status, 200);
        const c = create();
        const response = await fetch(`${base}/shipments/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.status, 'CREATED');
        const status = await fetch(`${base}/shipments/${c.orderId}`);
        assert.equal((await status.json()).shipment.status, 'CREATED');
        const reversed = await fetch(`${base}/shipments/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cancellation(c)) });
        assert.equal((await reversed.json()).data.status, 'CANCELLED');
      } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
    await t.test('create/cancellation race ends compensated with no orphaned create', async () => {
      const c = create(); const r = cancellation(c);
      const outcomes = await Promise.all([send(app, c), send(app, r)]);
      assert.ok(outcomes.every(o => [200, 202, 409].includes(o.status)));
      const result = await send(app, r);
      assert.equal(result.status, 200);
      const row = await shipment(c);
      assert.ok(!row || row.status === 'CANCELLED');
      assert.notEqual((await send(app, { ...c, idempotencyKey: randomUUID() })).status, 200);
    });
  } finally {
    await pool?.end(); await providerPool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
