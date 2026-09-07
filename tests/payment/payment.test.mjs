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
import { createApp } from '../../services/payment-service/dist/app.js';
import { PaymentService } from '../../services/payment-service/dist/payments/service.js';
import { LocalPaymentProvider } from '../../services/payment-service/dist/providers/local-provider.js';
import { ResultSchema } from '../../shared/dist/index.js';

const charge = () => ({ version: 1, operation: 'CHARGE_PAYMENT', orderId: randomUUID(), sagaId: randomUUID(), idempotencyKey: randomUUID(), payload: { customerId: randomUUID(), amountMinor: 12500, currency: 'BDT' } });
const refund = (c) => ({ ...c, operation: 'REFUND_PAYMENT', idempotencyKey: randomUUID(), payload: {} });
const send = async (app, c) => {
  const response = await app.request(`/payments/${c.operation === 'CHARGE_PAYMENT' ? 'charge' : 'refund'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
  const body = await response.json();
  if ([200, 202, 409, 422].includes(response.status)) ResultSchema.parse(body);
  return { status: response.status, body };
};

test('Payment Service HTTP handlers with real PostgreSQL and durable provider', async (t) => {
  const url = new URL(process.env.TEST_PAYMENT_DATABASE_URL ?? parse(readFileSync(new URL('../../services/payment-service/.env', import.meta.url))).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  const name = `saga_payment_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  let pool, providerPool;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    providerPool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../services/payment-service/drizzle/', import.meta.url)) });
    const provider = new LocalPaymentProvider(providerPool);
    const app = createApp(new PaymentService(pool, provider));
    const payment = async c => (await pool.query('SELECT * FROM payments WHERE order_id=$1', [c.orderId])).rows[0];

    await t.test('rejects malformed commands before database or provider writes', async () => {
      const before = (await pool.query('SELECT count(*) FROM payments')).rows[0].count;
      for (const body of ['{', JSON.stringify({ ...charge(), payload: { amountMinor: -1 } }), JSON.stringify({ ...charge(), forceFailure: true })]) {
        const response = await app.request('/payments/charge', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        assert.equal(response.status, 400);
      }
      assert.equal((await app.request('/payments/charge', { method: 'POST', body: '{}' })).status, 415);
      assert.equal((await app.request('/payments/charge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(40000) })).status, 413);
      assert.equal((await pool.query('SELECT count(*) FROM payments')).rows[0].count, before);
      assert.equal((await app.request('/payments/not-a-uuid')).status, 400);
      assert.equal((await app.request(`/payments/${randomUUID()}`)).status, 404);
    });
    await t.test('charges, reports status, refunds, and replays historical results', async () => {
      const c = charge();
      const first = await send(app, c);
      assert.equal(first.status, 200);
      assert.equal(first.body.data.status, 'CHARGED');
      assert.deepEqual(await send(app, c), first);
      const status = await (await app.request(`/payments/${c.orderId}`)).json();
      assert.equal(status.payment.amountMinor, 12500);
      assert.equal(status.payment.status, 'CHARGED');
      const r = refund(c);
      const reversed = await send(app, r);
      assert.equal(reversed.body.data.status, 'REFUNDED');
      assert.deepEqual(await send(app, r), reversed);
      assert.deepEqual(await send(app, c), first);
      assert.equal((await payment(c)).status, 'REFUNDED');
      assert.equal((await send(app, { ...c, idempotencyKey: randomUUID() })).body.error.code, 'ALREADY_COMPENSATED');
    });
    await t.test('concurrent duplicate charges and refunds produce one provider effect each', async () => {
      const c = charge();
      const results = await Promise.all(Array.from({ length: 20 }, () => send(app, c)));
      assert.ok(results.every(r => [200, 202].includes(r.status)));
      const expected = await send(app, c);
      assert.equal(expected.status, 200);
      for (const result of results.filter(r => r.status === 200)) assert.deepEqual(result, expected);
      const r = refund(c);
      const reversed = await Promise.all(Array.from({ length: 20 }, () => send(app, r)));
      assert.ok(reversed.every(r => [200, 202].includes(r.status)));
      assert.equal((await send(app, r)).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 2);
    });
    await t.test('rejects changed payloads, changed saga ownership, and reused keys across orders', async () => {
      const c = charge(); await send(app, c);
      for (const changed of [
        { ...c, payload: { ...c.payload, amountMinor: 2 } },
        { ...c, idempotencyKey: randomUUID(), payload: { ...c.payload, customerId: randomUUID() } },
        { ...c, idempotencyKey: randomUUID(), sagaId: randomUUID() },
        { ...c, orderId: randomUUID() },
        { ...refund(c), sagaId: randomUUID() },
      ]) assert.equal((await send(app, changed)).body.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await payment(c)).status, 'CHARGED');
    });
    await t.test('different client keys reuse the stable provider key', async () => {
      const c = charge(); const first = await send(app, c);
      const other = await send(app, { ...c, idempotencyKey: randomUUID() });
      assert.equal(other.body.data.providerTransactionId, first.body.data.providerTransactionId);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 1);
    });
    await t.test('refund before charge is a durable no-op and blocks delayed charges', async () => {
      const c = charge(); const r = refund(c);
      assert.equal((await send(app, r)).body.data.status, 'NOOP');
      const recreated = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool)));
      assert.equal((await send(recreated, c)).body.error.code, 'ALREADY_COMPENSATED');
      const status = await (await recreated.request(`/payments/${c.orderId}`)).json();
      assert.equal(status.payment, null);
      assert.equal(status.refund.status, 'NOOP');
    });
    await t.test('provider decline is saved and refunds safely do nothing', async () => {
      const failing = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool, 'reject')));
      const c = charge(); const result = await send(failing, c);
      assert.equal(result.status, 422);
      assert.deepEqual(await send(app, c), result);
      assert.equal((await payment(c)).status, 'FAILED');
      assert.equal((await send(app, refund(c))).body.data.status, 'NOOP');
    });
    await t.test('lost charge and refund responses reconcile after recreating provider and service', async () => {
      const flaky = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool, 'timeout-after-success')));
      const c = charge();
      assert.equal((await send(flaky, c)).status, 202);
      assert.equal((await payment(c)).status, 'PENDING');
      const restarted = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool)));
      assert.equal((await send(restarted, c)).status, 200);
      const r = refund(c);
      assert.equal((await send(flaky, r)).status, 202);
      assert.equal((await payment(c)).status, 'CHARGED');
      assert.equal((await send(restarted, r)).body.data.status, 'REFUNDED');
      assert.equal((await payment(c)).status, 'REFUNDED');
    });
    await t.test('refund reconciles an uncertain charge before compensating it', async () => {
      const flaky = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool, 'timeout-after-success')));
      const c = charge(); await send(flaky, c);
      const r = refund(c);
      assert.equal((await send(app, r)).body.data.status, 'REFUNDED');
      assert.equal((await payment(c)).status, 'REFUNDED');
    });
    await t.test('provider exceptions, wrong correlation, and deadlines remain pending', async () => {
      const brokenProviders = [
        { charge: async () => { throw new Error('offline'); }, refund: provider.refund.bind(provider) },
        { charge: async c => ({ ...(await provider.charge(c)), orderId: randomUUID() }), refund: provider.refund.bind(provider) },
        { charge: async () => new Promise(() => {}), refund: provider.refund.bind(provider) },
      ];
      for (const broken of brokenProviders) {
        const c = charge(); const brokenApp = createApp(new PaymentService(pool, broken, 25));
        assert.equal((await send(brokenApp, c)).status, 202);
        assert.equal((await payment(c)).status, 'PENDING');
        assert.equal((await send(app, c)).status, 200);
      }
    });
    await t.test('database failure after provider commit retries without a second charge', async () => {
      const c = charge();
      await pool.query(`CREATE FUNCTION fail_payment_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
      await pool.query('CREATE TRIGGER fail_update BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fail_payment_update()');
      try { assert.equal((await send(app, c)).status, 503); }
      finally { await pool.query('DROP TRIGGER fail_update ON payments'); await pool.query('DROP FUNCTION fail_payment_update()'); }
      assert.equal((await payment(c)).status, 'PENDING');
      const recreated = createApp(new PaymentService(pool, new LocalPaymentProvider(providerPool)));
      assert.equal((await send(recreated, c)).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 1);
    });
    await t.test('failed refund remains pending until a later successful attempt', async () => {
      const c = charge(); await send(app, c); const r = refund(c);
      const failingRefund = createApp(new PaymentService(pool, {
        charge: provider.charge.bind(provider),
        refund: async cmd => {
          const { payload: _, ...metadata } = cmd;
          return { ...metadata, outcome: 'FAILED', error: { code: 'INVALID_STATE', message: 'Injected refund rejection', retryable: false } };
        },
      }));
      assert.equal((await send(failingRefund, r)).status, 409);
      assert.equal((await payment(c)).status, 'CHARGED');
      assert.equal((await pool.query('SELECT status FROM refunds WHERE order_id=$1', [c.orderId])).rows[0].status, 'PENDING');
      assert.equal((await send(app, r)).body.data.status, 'REFUNDED');
      assert.equal((await payment(c)).status, 'REFUNDED');
    });
    await t.test('refund finalization failure rolls back local state and safely retries', async () => {
      const c = charge(); await send(app, c); const r = refund(c);
      await pool.query(`CREATE FUNCTION fail_refund_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
      await pool.query('CREATE TRIGGER fail_refund BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION fail_refund_update()');
      try { assert.equal((await send(app, r)).status, 503); }
      finally { await pool.query('DROP TRIGGER fail_refund ON refunds'); await pool.query('DROP FUNCTION fail_refund_update()'); }
      assert.equal((await payment(c)).status, 'CHARGED');
      assert.equal((await send(app, r)).body.data.status, 'REFUNDED');
      assert.equal((await payment(c)).status, 'REFUNDED');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM simulated_provider_requests WHERE result->>\'orderId\'=$1', [c.orderId])).rows[0].n, 2);
    });
    await t.test('UUID case normalizes consistently and maximum amount stays exact', async () => {
      const c = charge(); c.payload.amountMinor = 9_999_999_999;
      const upper = { ...c, orderId: c.orderId.toUpperCase(), sagaId: c.sagaId.toUpperCase(), payload: { ...c.payload, customerId: c.payload.customerId.toUpperCase() } };
      assert.equal((await send(app, upper)).status, 200);
      assert.equal((await send(app, c)).status, 200);
      assert.equal((await payment(c)).amount_minor, '9999999999');
    });
    await t.test('late provider response cannot recreate a refunded charge', async () => {
      const c = charge(); let pending;
      const delayed = { charge: cmd => {
        pending = new Promise(resolve => setTimeout(resolve, 80)).then(() => provider.charge(cmd));
        return pending;
      }, refund: provider.refund.bind(provider) };
      const slow = createApp(new PaymentService(pool, delayed, 5));
      assert.equal((await send(slow, c)).status, 202);
      assert.equal((await send(app, refund(c))).body.data.status, 'REFUNDED');
      await pending;
      assert.equal((await payment(c)).status, 'REFUNDED');
      assert.equal((await pool.query('SELECT status FROM simulated_provider_payments WHERE order_id=$1', [c.orderId])).rows[0].status, 'REFUNDED');
    });
    await t.test('serves health, charge, status and refund over a real HTTP socket', async () => {
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      try {
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await fetch(`${base}/health`)).status, 200);
        const c = charge();
        const response = await fetch(`${base}/payments/charge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.status, 'CHARGED');
        const status = await fetch(`${base}/payments/${c.orderId}`);
        assert.equal((await status.json()).payment.status, 'CHARGED');
        const reversed = await fetch(`${base}/payments/refund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(refund(c)) });
        assert.equal((await reversed.json()).data.status, 'REFUNDED');
      } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
    await t.test('charge/refund race ends compensated with no orphaned charge', async () => {
      const c = charge(); const r = refund(c);
      const outcomes = await Promise.all([send(app, c), send(app, r)]);
      assert.ok(outcomes.every(o => [200, 202, 409].includes(o.status)));
      const result = await send(app, r);
      assert.equal(result.status, 200);
      const row = await payment(c);
      assert.ok(!row || row.status === 'REFUNDED');
      assert.notEqual((await send(app, { ...c, idempotencyKey: randomUUID() })).status, 200);
    });
  } finally {
    await pool?.end(); await providerPool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
