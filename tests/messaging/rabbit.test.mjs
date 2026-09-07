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
import { BrokerOrderService } from '../../services/order-orchestrator/dist/saga/brokerOrders.js';
import { RabbitWorker, participantHandler, topology, confirmed, relayOnce, EnvelopeSchema } from '@saga/shared/messaging';
import amqp from 'amqplib';

const uncertain = c => {
  const { payload: _, ...meta } = c;
  return { ...meta, outcome: 'UNKNOWN', error: { code: 'PROVIDER_UNAVAILABLE', message: 'Injected response loss', retryable: true } };
};
const post = async (app, request) => {
  const r = await app.request('/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  return { status: r.status, location: r.headers.get('location'), body: await r.json() };
};

const eventually = async (read, predicate, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.fail(`Timed out waiting for expected state: ${JSON.stringify(value)}`);
};
test('RabbitMQ saga, durable outboxes, redelivery and compensation', async t => {
  const fixtures = [], workers = [], dbs = {};
  const prefix = `saga.test.${randomUUID()}`;
  const url = process.env.TEST_RABBITMQ_URL ?? 'amqp://saga:saga@127.0.0.1:5672';
  let connection, channel;
  try {
    for (const [name, key] of [['payment-service', 'PAYMENT'], ['inventory-service', 'INVENTORY'], ['shipping-service', 'SHIPPING'], ['order-orchestrator', 'ORDER']]) {
      const databaseUrl = new URL(process.env[`TEST_${key}_DATABASE_URL`] ?? parse(readFileSync(new URL(`../../services/${name}/.env`, import.meta.url))).DATABASE_URL);
      const admin = new pg.Pool({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5000 });
      const fixture = { admin, name: `saga_broker_test_${randomUUID().replaceAll('-', '')}`, created: false }; fixtures.push(fixture);
      await admin.query(`CREATE DATABASE "${fixture.name}"`); fixture.created = true;
      databaseUrl.pathname = `/${fixture.name}`;
      fixture.pool = new pg.Pool({ connectionString: databaseUrl.href, max: 10, connectionTimeoutMillis: 5000 });
      fixture.providerPool = new pg.Pool({ connectionString: databaseUrl.href, max: 10, connectionTimeoutMillis: 5000 });
      dbs[key] = fixture;
      await migrate(drizzle(fixture.pool), { migrationsFolder: fileURLToPath(new URL(`../../services/${name}/drizzle/`, import.meta.url)) });
    }
    connection = await amqp.connect(url);
    channel = await connection.createConfirmChannel();
    await topology(channel, prefix);
    const broker = new BrokerOrderService(dbs.ORDER.pool, 50);
    const app = createApp(broker);
    let paymentMode = 'success', shippingMode = 'success', intercept;
    const execute = async (participant, command, commit) => {
      if (intercept) {
        const result = await intercept(command);
        if (result) return result;
      }
      if (participant === 'payment') return new PaymentService(dbs.PAYMENT.pool, new LocalPaymentProvider(dbs.PAYMENT.providerPool, paymentMode)).execute(command, commit);
      if (participant === 'shipping') return new ShippingService(dbs.SHIPPING.pool, new LocalShippingProvider(dbs.SHIPPING.providerPool, shippingMode)).execute(command, commit);
      return new InventoryService(dbs.INVENTORY.pool).execute(command, commit);
    };
    const handlers = Object.fromEntries(['payment', 'inventory', 'shipping'].map(name => [name,
      participantHandler(dbs[name.toUpperCase()].pool, name, (c, commit) => execute(name, c, commit))]));
    const errors = [];
    const makeWorker = (name, handler = name === 'orders' ? e => broker.receive(e) : handlers[name]) => {
      const w = new RabbitWorker(dbs[name === 'orders' ? 'ORDER' : name.toUpperCase()].pool, name, handler,
        { url, prefix, intervalMs: 20, onError: e => errors.push(e.cause?.message ?? e.message) });
      workers.push(w); return w;
    };
    let orderWorker = makeWorker('orders');
    const participants = ['payment', 'inventory', 'shipping'].map(name => makeWorker(name));
    const request = async (stock = 10) => {
      const productId = randomUUID();
      await dbs.INVENTORY.pool.query("INSERT INTO products(id,sku,name,available_stock) VALUES ($1,$2,'Broker test',$3)", [productId, productId, stock]);
      return { idempotencyKey: randomUUID(), payload: { customerId: randomUUID(), items: [{ productId, quantity: 2 }], amountMinor: 12500, currency: 'BDT',
        shippingAddress: { recipient: 'Test', line1: '10 Road', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' } } };
    };
    const finish = (id, status = 'COMPLETED') => eventually(() => broker.status(id), s => s?.saga.status === status);
    const row = async (key, table, id) => (await dbs[key].pool.query(`SELECT * FROM ${table} WHERE order_id=$1`, [id])).rows[0];
    const stock = async req => (await dbs.INVENTORY.pool.query('SELECT available_stock FROM products WHERE id=$1', [req.payload.items[0].productId])).rows[0].available_stock;
    const publish = e => confirmed(channel, prefix, e.kind === 'RESULT' ? 'orders' : e.body.operation.includes('PAYMENT') ? 'payment' : e.body.operation.includes('SHIPMENT') ? 'shipping' : 'inventory', Buffer.from(JSON.stringify(e)), { messageId: e.messageId, contentType: 'application/json' });

    await t.test('order acceptance and first outbox commit together while broker publishing is offline', async () => {
      const first = await post(app, await request()); assert.equal(first.status, 202);
      const saved = (await dbs.ORDER.pool.query('SELECT * FROM message_outbox WHERE id=$1', [first.body.saga.pendingMessageId])).rows[0];
      assert.equal(saved.published_at, null); assert.equal(saved.envelope.body.operation, 'CHARGE_PAYMENT');
      assert.equal(await row('PAYMENT', 'payments', first.body.order.id), undefined);
      orderWorker.start(); participants.forEach(w => w.start());
      const final = await finish(first.body.order.id);
      assert.deepEqual(final.saga.completedSteps, ['PAYMENT', 'INVENTORY', 'SHIPPING']);
      assert.equal(final.saga.inventoryFinalized, true);
      assert.equal((await row('INVENTORY', 'reservations', first.body.order.id)).status, 'FINALIZED');
    });
    await t.test('concurrent HTTP duplicates create one asynchronous saga', async () => {
      const req = await request(); const responses = await Promise.all(Array.from({ length: 10 }, () => post(app, req)));
      assert.equal(new Set(responses.map(r => r.body.order.id)).size, 1);
      const final = await finish(responses[0].body.order.id); assert.equal(final.saga.attempts, 4);
      assert.equal((await post(app, req)).status, 200);
    });
    await t.test('inventory rejection refunds and shipping rejection releases then refunds', async () => {
      const empty = await post(app, await request(0));
      const failed = await finish(empty.body.order.id, 'FAILED'); assert.deepEqual(failed.saga.compensatedSteps, ['PAYMENT']);
      assert.equal((await row('PAYMENT', 'payments', empty.body.order.id)).status, 'REFUNDED');
      shippingMode = 'reject';
      try {
        const req = await request(); const first = await post(app, req); const final = await finish(first.body.order.id, 'FAILED');
        assert.deepEqual(final.saga.compensatedSteps, ['INVENTORY', 'PAYMENT']); assert.equal(await stock(req), 10);
        assert.equal((await row('PAYMENT', 'payments', first.body.order.id)).status, 'REFUNDED');
      } finally { shippingMode = 'success'; }
    });
    await t.test('payment decline produces FAILED without inventory or compensation', async () => {
      paymentMode = 'reject';
      try {
        const first = await post(app, await request()); const final = await finish(first.body.order.id, 'FAILED');
        assert.deepEqual(final.saga.completedSteps, []); assert.equal(await row('INVENTORY', 'reservations', first.body.order.id), undefined);
      } finally { paymentMode = 'success'; }
    });
    await t.test('uncertain provider outcomes reconcile through new messages with stable business keys', async () => {
      paymentMode = shippingMode = 'timeout-after-success';
      try {
        const first = await post(app, await request()); const final = await finish(first.body.order.id);
        assert.equal(final.saga.attempts, 6);
        assert.equal((await dbs.PAYMENT.pool.query("SELECT count(*)::int n FROM simulated_provider_requests WHERE result->>'orderId'=$1", [first.body.order.id])).rows[0].n, 1);
      } finally { paymentMode = shippingMode = 'success'; }
    });
    await t.test('duplicate and delayed commands/results cannot repeat effects or rewind state', async () => {
      const req = await request(); const first = await post(app, req); const final = await finish(first.body.order.id);
      const commands = (await dbs.ORDER.pool.query("SELECT envelope FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows;
      const results = (await dbs.PAYMENT.pool.query("SELECT envelope FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows;
      for (const { envelope } of [...commands.reverse(), ...results, ...results]) await publish(envelope);
      // A different delivery ID with the old causation is also stale, not a new step.
      await broker.receive({ ...results[0].envelope, messageId: randomUUID() });
      await new Promise(r => setTimeout(r, 200));
      assert.equal((await broker.status(first.body.order.id)).saga.version, final.saga.version);
      assert.equal(await stock(req), 8);
    });
    await t.test('poison messages and mismatched result correlation reach the dead-letter queue', async () => {
      const id = randomUUID();
      await confirmed(channel, prefix, 'orders', Buffer.from('{broken'), { messageId: id, contentType: 'application/json' });
      const dead = await eventually(() => channel.get(`${prefix}.orders.dead`, { noAck: false }), m => !!m);
      assert.equal(dead.properties.messageId, id); channel.ack(dead);
      const req = await request(); const first = await post(app, req); await finish(first.body.order.id);
      const event = (await dbs.PAYMENT.pool.query("SELECT envelope FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows[0].envelope;
      const bad = { ...event, messageId: randomUUID(), body: { ...event.body, sagaId: randomUUID() } };
      await publish(bad);
      const rejected = await eventually(() => channel.get(`${prefix}.orders.dead`, { noAck: false }), m => !!m);
      assert.equal(rejected.properties.messageId, bad.messageId); channel.ack(rejected);
      assert.throws(() => EnvelopeSchema.parse({ ...bad, version: 2 }));
    });
    await t.test('unroutable publications remain in the outbox', async () => {
      await orderWorker.stop();
      const id = randomUUID(); const envelope = { version: 1, messageId: id, kind: 'COMMAND', createdAt: new Date().toISOString(), body: {} };
      await dbs.ORDER.pool.query('INSERT INTO message_outbox(id,route,envelope) VALUES ($1,$2,$3)', [id, 'missing.route', envelope]);
      await assert.rejects(relayOnce(dbs.ORDER.pool, channel, prefix), /Unroutable/);
      assert.equal((await dbs.ORDER.pool.query('SELECT published_at FROM message_outbox WHERE id=$1', [id])).rows[0].published_at, null);
      await dbs.ORDER.pool.query('DELETE FROM message_outbox WHERE id=$1', [id]);
      orderWorker = makeWorker('orders'); orderWorker.start();
    });
    await t.test('outbox failure rolls back accepted order and all initial progress', async () => {
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_outbox BEFORE INSERT ON message_outbox FOR EACH ROW EXECUTE FUNCTION reject_outbox()');
      const req = await request();
      try { assert.equal((await post(app, req)).status, 503); }
      finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_outbox ON message_outbox'); await dbs.ORDER.pool.query('DROP FUNCTION reject_outbox()'); }
      assert.equal((await dbs.ORDER.pool.query('SELECT count(*)::int n FROM orders WHERE idempotency_key=$1', [req.idempotencyKey])).rows[0].n, 0);
      await finish((await post(app, req)).body.order.id);
    });
    await t.test('participant result-outbox failure rolls back local completion and redelivery recovers', async () => {
      await dbs.INVENTORY.pool.query("CREATE FUNCTION reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$");
      await dbs.INVENTORY.pool.query('CREATE TRIGGER reject_result BEFORE INSERT ON message_outbox FOR EACH ROW EXECUTE FUNCTION reject_result()');
      const req = await request(); const first = await post(app, req);
      try {
        await eventually(() => broker.status(first.body.order.id), s => s.saga.currentOperation === 'RESERVE_INVENTORY');
        await eventually(() => Promise.resolve(errors.filter(e => e === 'injected').length), n => n > 0);
        assert.equal(await stock(req), 10); assert.equal(await row('INVENTORY', 'reservations', first.body.order.id), undefined);
      } finally { await dbs.INVENTORY.pool.query('DROP TRIGGER reject_result ON message_outbox'); await dbs.INVENTORY.pool.query('DROP FUNCTION reject_result()'); }
      await finish(first.body.order.id); assert.equal(await stock(req), 8);
    });
    await t.test('failed compensation retries are bounded and remain COMPENSATING until manual resume', async () => {
      shippingMode = 'reject';
      intercept = async c => c.operation === 'RELEASE_INVENTORY' ? uncertain(c) : undefined;
      const req = await request(); const first = await post(app, req);
      try {
        const pending = await eventually(() => broker.status(first.body.order.id), s => s.saga.status === 'COMPENSATING' && s.saga.brokerAttempts === 3 && !s.saga.pendingMessageId);
        assert.deepEqual(pending.saga.compensatedSteps, []); assert.equal(await stock(req), 8);
        assert.equal((await row('PAYMENT', 'payments', first.body.order.id)).status, 'CHARGED');
        const dead = await eventually(() => channel.get(`${prefix}.orders.dead`, { noAck: false }), m => !!m); channel.ack(dead);
      } finally { intercept = undefined; shippingMode = 'success'; }
      const resumed = await app.request(`/orders/${first.body.order.id}/resume`, { method: 'POST' }); assert.equal(resumed.status, 202);
      const final = await finish(first.body.order.id, 'FAILED'); assert.deepEqual(final.saga.compensatedSteps, ['INVENTORY', 'PAYMENT']); assert.equal(await stock(req), 10);
    });
    await t.test('broker connection loss reconnects and republishes pending work', async () => {
      await orderWorker.stop();
      const first = await post(app, await request()); assert.equal(first.status, 202);
      orderWorker = makeWorker('orders'); orderWorker.start();
      await eventually(() => Promise.resolve(orderWorker.connection), c => !!c);
      await orderWorker.connection.close();
      await finish(first.body.order.id);
    });
    await t.test('processing committed before acknowledgement is safely redelivered', async () => {
      await participants[0].stop();
      let deliveries = 0;
      const replacement = makeWorker('payment', async envelope => {
        await handlers.payment(envelope);
        deliveries++;
        if (deliveries === 1) throw new Error('Injected loss before acknowledgement');
      });
      replacement.start();
      const first = await post(app, await request()); await finish(first.body.order.id);
      await eventually(() => Promise.resolve(deliveries), n => n >= 2);
      assert.equal((await dbs.PAYMENT.pool.query("SELECT count(*)::int n FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows[0].n, 1);
      await replacement.stop(); participants[0].start();
    });
    await t.test('publisher-confirm then database failure republishes without repeating business effects', async () => {
      await orderWorker.stop();
      const first = await post(app, await request());
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_published() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_published BEFORE UPDATE ON message_outbox FOR EACH ROW EXECUTE FUNCTION reject_published()');
      try {
        await assert.rejects(relayOnce(dbs.ORDER.pool, channel, prefix));
        assert.equal((await dbs.ORDER.pool.query('SELECT published_at FROM message_outbox WHERE id=$1', [first.body.saga.pendingMessageId])).rows[0].published_at, null);
      } finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_published ON message_outbox'); await dbs.ORDER.pool.query('DROP FUNCTION reject_published()'); }
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
      assert.equal((await dbs.PAYMENT.pool.query("SELECT count(*)::int n FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows[0].n, 1);
    });
    await t.test('result inbox, saga transition and next command roll back together', async () => {
      const baseline = errors.filter(e => e === 'injected-next').length;
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_next() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.envelope->'body'->>'operation'='RESERVE_INVENTORY' THEN RAISE EXCEPTION 'injected-next'; END IF; RETURN NEW; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_next BEFORE INSERT ON message_outbox FOR EACH ROW EXECUTE FUNCTION reject_next()');
      const first = await post(app, await request());
      try {
        await eventually(() => Promise.resolve(errors.filter(e => e === 'injected-next').length), n => n > baseline);
        const pending = await broker.status(first.body.order.id);
        assert.deepEqual(pending.saga.completedSteps, []);
        assert.equal(pending.saga.currentOperation, 'CHARGE_PAYMENT');
        const event = (await dbs.PAYMENT.pool.query("SELECT envelope FROM message_outbox WHERE envelope->'body'->>'orderId'=$1", [first.body.order.id])).rows[0].envelope;
        assert.equal((await dbs.ORDER.pool.query('SELECT count(*)::int n FROM message_inbox WHERE id=$1', [event.messageId])).rows[0].n, 0);
      } finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_next ON message_outbox'); await dbs.ORDER.pool.query('DROP FUNCTION reject_next()'); }
      await finish(first.body.order.id);
    });
    await t.test('finalization response loss reconciles without releasing finalized stock', async () => {
      let lost = false;
      intercept = async c => {
        if (c.operation !== 'FINALIZE_INVENTORY' || lost) return;
        lost = true;
        await new InventoryService(dbs.INVENTORY.pool).execute(c);
        return uncertain(c);
      };
      try {
        const req = await request(); const first = await post(app, req); const final = await finish(first.body.order.id);
        assert.equal(final.saga.attempts, 5); assert.deepEqual(final.saga.compensatedSteps, []); assert.equal(await stock(req), 8);
      } finally { intercept = undefined; }
    });
    await t.test('persistent handler errors stop after bounded delivery retries in the consumer DLQ', async () => {
      let failures = 0;
      intercept = async c => { if (c.operation === 'CHARGE_PAYMENT') { failures++; throw new Error('Injected persistent handler error'); } };
      try {
        const first = await post(app, await request());
        const dead = await eventually(() => channel.get(`${prefix}.payment.dead`, { noAck: false }), m => !!m);
        assert.equal(failures, 3); assert.equal(dead.properties.messageId, first.body.saga.pendingMessageId);
        assert.equal((await broker.status(first.body.order.id)).saga.status, 'IN_PROGRESS');
        intercept = undefined;
        const envelope = JSON.parse(dead.content.toString()); await publish(envelope); channel.ack(dead);
        await finish(first.body.order.id);
      } finally { intercept = undefined; }
    });
  } finally {
    for (const worker of workers) await worker.stop();
    if (connection) {
      const cleanup = await connection.createChannel();
      for (const name of ['payment', 'inventory', 'shipping', 'orders']) for (const suffix of ['', '.retry', '.dead']) await cleanup.deleteQueue(`${prefix}.${name}${suffix}`);
      await cleanup.deleteExchange(prefix); await cleanup.deleteExchange(`${prefix}.dead`);
      await connection.close();
    }
    for (const fixture of fixtures.reverse()) {
      await fixture.pool?.end(); await fixture.providerPool?.end();
      if (fixture.created) await fixture.admin.query(`DROP DATABASE "${fixture.name}"`);
      await fixture.admin.end();
    }
  }
});
