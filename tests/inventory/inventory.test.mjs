import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { serve } from '@hono/node-server';
import { createApp } from '../../services/inventory-service/dist/app.js';
import { InventoryService } from '../../services/inventory-service/dist/inventory/service.js';
import { ResultSchema, CommandSchema } from '../../shared/dist/index.js';

const reserve = items => ({ version: 1, operation: 'RESERVE_INVENTORY', orderId: randomUUID(), sagaId: randomUUID(), idempotencyKey: randomUUID(), payload: { items } });
const release = c => ({ ...c, operation: 'RELEASE_INVENTORY', idempotencyKey: randomUUID(), payload: {} });
const finalize = c => ({ ...release(c), operation: 'FINALIZE_INVENTORY' });
const route = c => ({ RESERVE_INVENTORY: 'reserve', RELEASE_INVENTORY: 'release', FINALIZE_INVENTORY: 'finalize' })[c.operation];
const send = async (app, c) => {
  const response = await app.request(`/inventory/${route(c)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
  const body = await response.json();
  if ([200, 409, 422].includes(response.status)) ResultSchema.parse(body);
  return { status: response.status, body };
};

test('Inventory Service against real PostgreSQL', async t => {
  const url = new URL(process.env.TEST_INVENTORY_DATABASE_URL ?? parse(readFileSync(new URL('../../services/inventory-service/.env', import.meta.url))).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  const name = `saga_inventory_test_${randomUUID().replaceAll('-', '')}`;
  let pool, created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../services/inventory-service/drizzle/', import.meta.url)) });
    const app = createApp(new InventoryService(pool));
    const product = async stock => {
      const id = randomUUID();
      await pool.query('INSERT INTO products(id,sku,name,available_stock) VALUES ($1,$2,\'Test Product\',$3)', [id, id, stock]);
      return id;
    };
    const stock = async id => (await pool.query('SELECT available_stock FROM products WHERE id=$1', [id])).rows[0].available_stock;
    const status = async c => (await (await app.request(`/inventory/reservations/${c.orderId}`)).json());

    await t.test('validates input and finalization contracts before writes', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 2 }]);
      for (const payload of [{ items: [] }, { items: [{ productId: id, quantity: 0 }] }, { items: [{ productId: id, quantity: 1.1 }] }, { items: [...c.payload.items, ...c.payload.items] }]) {
        assert.equal((await send(app, { ...c, payload })).status, 400);
      }
      assert.equal((await send(app, { ...c, forceFailure: true })).status, 400);
      assert.equal((await app.request('/inventory/reserve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
      assert.equal((await app.request('/inventory/reserve', { method: 'POST', body: '{}' })).status, 415);
      assert.equal((await app.request('/inventory/reserve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(40000) })).status, 413);
      assert.equal((await app.request('/inventory/reservations/bad')).status, 400);
      assert.equal((await app.request(`/inventory/reservations/${randomUUID()}`)).status, 404);
      assert.ok(CommandSchema.safeParse(finalize(c)).success);
      assert.equal(CommandSchema.safeParse({ ...finalize(c), payload: c.payload }).success, false);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reservations')).rows[0].n, 0);
      assert.equal(await stock(id), 10);
    });
    await t.test('reserve/release replays are durable and never alter stock twice', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 3 }]);
      const first = await send(app, c); assert.equal(first.status, 200); assert.equal(await stock(id), 7);
      assert.deepEqual(await send(app, c), first);
      const recreated = createApp(new InventoryService(pool));
      assert.deepEqual(await send(recreated, c), first);
      assert.equal((await status(c)).items[0].quantity, 3);
      const r = release(c); const reversed = await send(app, r);
      assert.equal(reversed.body.data.status, 'RELEASED'); assert.equal(await stock(id), 10);
      assert.deepEqual(await send(recreated, r), reversed);
      assert.equal((await send(app, release(c))).body.data.status, 'NOOP');
      assert.deepEqual(await send(app, c), first);
      assert.equal((await status(c)).reservation.status, 'RELEASED');
      assert.equal((await send(app, { ...c, idempotencyKey: randomUUID() })).body.error.code, 'ALREADY_COMPENSATED');
      assert.equal(await stock(id), 10);
    });
    await t.test('concurrent identical reserve/release commands return identical saved results', async () => {
      const id = await product(20); const c = reserve([{ productId: id, quantity: 4 }]);
      const outcomes = await Promise.all(Array.from({ length: 20 }, () => send(app, c)));
      for (const result of outcomes) { assert.equal(result.status, 200); assert.deepEqual(result, outcomes[0]); }
      assert.equal(await stock(id), 16);
      const r = release(c); const released = await Promise.all(Array.from({ length: 20 }, () => send(app, r)));
      for (const result of released) assert.deepEqual(result, released[0]);
      assert.equal(await stock(id), 20);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reservation_items WHERE reservation_id=$1', [outcomes[0].body.data.reservationId])).rows[0].n, 1);
    });
    await t.test('distinct orders cannot oversell limited stock', async () => {
      const id = await product(5);
      const outcomes = await Promise.all(Array.from({ length: 15 }, () => send(app, reserve([{ productId: id, quantity: 1 }]))));
      assert.equal(outcomes.filter(r => r.status === 200).length, 5);
      assert.equal(outcomes.filter(r => r.status === 422).length, 10);
      assert.equal(await stock(id), 0);
    });
    await t.test('insufficient or missing products fail the whole basket with no partial decrement', async () => {
      const first = await product(10); const second = await product(0);
      for (const unavailable of [second, randomUUID()]) {
        const c = reserve([{ productId: first, quantity: 3 }, { productId: unavailable, quantity: 1 }]);
        const failed = await send(app, c);
        assert.equal(failed.body.error.code, 'INSUFFICIENT_STOCK');
        assert.equal(await stock(first), 10);
        assert.deepEqual((await status(c)).items, []);
        assert.equal((await status(c)).reservation.status, 'FAILED');
        assert.equal((await send(app, release(c))).body.data.status, 'NOOP');
      }
    });
    await t.test('failed reservations retain their outcome after replenishment and key changes', async () => {
      const id = await product(0); const c = reserve([{ productId: id, quantity: 1 }]);
      const failed = await send(app, c);
      await pool.query('UPDATE products SET available_stock=10 WHERE id=$1', [id]);
      assert.deepEqual(await send(app, c), failed);
      assert.equal((await send(app, { ...c, idempotencyKey: randomUUID() })).status, 422);
      assert.equal(await stock(id), 10);
    });
    await t.test('conflicting payloads, ownership and cross-order key reuse are rejected', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 2 }]); await send(app, c);
      for (const changed of [
        { ...c, payload: { items: [{ productId: id, quantity: 3 }] } },
        { ...c, idempotencyKey: randomUUID(), payload: { items: [{ productId: id, quantity: 3 }] } },
        { ...c, orderId: randomUUID() },
        { ...release(c), sagaId: randomUUID() },
        { ...finalize(c), sagaId: randomUUID() },
      ]) assert.equal((await send(app, changed)).body.error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(await stock(id), 8);
    });
    await t.test('basket order and UUID letter case normalize without a second reservation', async () => {
      const a = await product(10); const b = await product(10); const c = reserve([{ productId: a, quantity: 2 }, { productId: b, quantity: 1 }]);
      const first = await send(app, c);
      const reordered = { ...c, orderId: c.orderId.toUpperCase(), sagaId: c.sagaId.toUpperCase(), payload: { items: [...c.payload.items].reverse().map(i => ({ ...i, productId: i.productId.toUpperCase() })) } };
      assert.deepEqual(await send(app, reordered), first);
      assert.equal((await send(app, { ...reordered, idempotencyKey: randomUUID() })).body.data.reservationId, first.body.data.reservationId);
      assert.equal(await stock(a), 8); assert.equal(await stock(b), 9);
    });
    await t.test('opposite basket ordering under contention does not deadlock', async () => {
      const a = await product(10); const b = await product(10);
      const outcomes = await Promise.all(Array.from({ length: 10 }, (_, i) => send(app, reserve((i % 2 ? [a, b] : [b, a]).map(productId => ({ productId, quantity: 1 }))))));
      assert.ok(outcomes.every(r => r.status === 200));
      assert.equal(await stock(a), 0); assert.equal(await stock(b), 0);
    });
    await t.test('release before reserve creates a durable compensation marker', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 1 }]);
      assert.equal((await send(app, release(c))).body.data.status, 'NOOP');
      assert.equal((await send(createApp(new InventoryService(pool)), c)).body.error.code, 'ALREADY_COMPENSATED');
      assert.equal((await status(c)).reservation.status, 'RELEASED'); assert.equal(await stock(id), 10);
    });
    await t.test('finalization is repeatable and prevents release or automatic expiry', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 2 }]); await send(app, c);
      const f = finalize(c); const finished = await send(app, f);
      assert.equal(finished.body.data.status, 'FINALIZED');
      assert.deepEqual(await send(app, f), finished);
      assert.equal((await send(app, finalize(c))).status, 200);
      assert.equal((await send(app, release(c))).body.error.code, 'INVALID_STATE');
      assert.equal((await status(c)).reservation.expiresAt, null); assert.equal(await stock(id), 8);
      assert.equal((await send(app, finalize(reserve([{ productId: id, quantity: 1 }])))).status, 409);
    });
    await t.test('injected receipt write failure rolls back reservation and every stock change', async () => {
      const a = await product(10); const b = await product(10); const c = reserve([{ productId: a, quantity: 2 }, { productId: b, quantity: 3 }]);
      await pool.query("CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$");
      await pool.query('CREATE TRIGGER reject_receipt BEFORE UPDATE ON command_receipts FOR EACH ROW EXECUTE FUNCTION reject_receipt()');
      try { assert.equal((await send(app, c)).status, 503); }
      finally { await pool.query('DROP TRIGGER reject_receipt ON command_receipts'); await pool.query('DROP FUNCTION reject_receipt()'); }
      assert.equal(await stock(a), 10); assert.equal(await stock(b), 10);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reservations WHERE order_id=$1', [c.orderId])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=$1', [c.idempotencyKey])).rows[0].n, 0);
      assert.equal((await send(app, c)).status, 200);
    });
    await t.test('failed release transaction preserves the reservation and retries safely', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 2 }]); await send(app, c); const r = release(c);
      await pool.query("CREATE FUNCTION reject_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$");
      await pool.query('CREATE TRIGGER reject_release BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION reject_release()');
      try { assert.equal((await send(app, r)).status, 503); }
      finally { await pool.query('DROP TRIGGER reject_release ON reservations'); await pool.query('DROP FUNCTION reject_release()'); }
      assert.equal(await stock(id), 8); assert.equal((await status(c)).reservation.status, 'RESERVED');
      assert.equal((await send(app, r)).status, 200); assert.equal(await stock(id), 10);
    });
    await t.test('reserve/release and finalize/release races conserve stock', async () => {
      const id = await product(10); const c = reserve([{ productId: id, quantity: 2 }]);
      await Promise.all([send(app, c), send(app, release(c))]);
      assert.equal((await status(c)).reservation.status, 'RELEASED'); assert.equal(await stock(id), 10);
      const next = reserve([{ productId: id, quantity: 3 }]); await send(app, next);
      const outcomes = await Promise.all([send(app, finalize(next)), send(app, release(next))]);
      assert.equal(outcomes.filter(r => r.status === 200).length, 1);
      const final = (await status(next)).reservation.status;
      assert.equal(await stock(id), final === 'FINALIZED' ? 7 : 10);
    });
    await t.test('real HTTP reserve/status/release works and closes its server', async () => {
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      try {
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const c = reserve([{ productId: await product(5), quantity: 1 }]);
        assert.equal((await fetch(`${base}/health`)).status, 200);
        const result = await fetch(`${base}/inventory/reserve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
        assert.equal((await result.json()).data.status, 'RESERVED');
        const state = await fetch(`${base}/inventory/reservations/${c.orderId}`);
        assert.equal((await state.json()).reservation.status, 'RESERVED');
        const reversed = await fetch(`${base}/inventory/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(release(c)) });
        assert.equal((await reversed.json()).data.status, 'RELEASED');
      } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
  } finally {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
