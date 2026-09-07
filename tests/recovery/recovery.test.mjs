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
import { RecoveryWorker } from '../../services/order-orchestrator/dist/saga/recoveryWorker.js';
import { readiness, structuredLogger } from '@saga/shared/messaging';
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
test('Recovery workers, deadlines, leases and observability', async t => {
  const fixtures = [], workers = [], recoveries = [], dbs = {};
  const logs = [];
  const prefix = `saga.recovery.${randomUUID()}`;
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
    const broker = new BrokerOrderService(dbs.ORDER.pool, 50, 1000);
    const app = createApp(broker);
    let dropResult;
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
    const makeWorker = (name, handler = name === 'orders' ? async e => { if (!dropResult?.(e)) await broker.receive(e); } : handlers[name]) => {
      const w = new RabbitWorker(dbs[name === 'orders' ? 'ORDER' : name.toUpperCase()].pool, name, handler,
        { url, prefix, intervalMs: 20, log: entry => logs.push(entry), onError: e => errors.push(e.cause?.message ?? e.message) });
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

    const expire = async id => {
      await dbs.ORDER.pool.query("UPDATE message_outbox SET published_at=now()-interval '10 seconds' WHERE id=(SELECT pending_message_id FROM saga_instances WHERE order_id=$1)", [id]);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET next_attempt_at=now()-interval '1 second',response_deadline_at=now()-interval '1 second' WHERE order_id=$1", [id]);
    };
    const recover = async id => {
      const claims = await broker.claimRecovery(100);
      const claim = claims.find(c => c.orderId === id); assert.ok(claim);
      await broker.recoverClaim(id, claim.token);
      return claim;
    };
    const recovery = new RecoveryWorker(broker, 30, entry => logs.push(entry)); recoveries.push(recovery);
    participants.forEach(w => w.start());
    orderWorker.start();

    await t.test('lost payment result resumes after recovery worker restart without a second charge', async () => {
      let dropped;
      dropResult = e => { if (e.body.operation === 'CHARGE_PAYMENT' && !dropped) { dropped = e; return true; } return false; };
      const first = await post(app, await request());
      await eventually(() => Promise.resolve(dropped), Boolean);
      assert.equal((await row('PAYMENT', 'payments', first.body.order.id)).status, 'CHARGED');
      await expire(first.body.order.id);
      const restarted = new RecoveryWorker(new BrokerOrderService(dbs.ORDER.pool, 50, 1000), 30); recoveries.push(restarted);
      restarted.start();
      try { await finish(first.body.order.id); } finally { await restarted.stop(); dropResult = undefined; }
      assert.equal((await dbs.PAYMENT.pool.query("SELECT count(*)::int n FROM simulated_provider_requests WHERE result->>'orderId'=$1", [first.body.order.id])).rows[0].n, 1);
    });
    await t.test('missing release result reconciles compensation without restoring stock twice', async () => {
      shippingMode = 'reject'; let dropped;
      dropResult = e => { if (e.body.operation === 'RELEASE_INVENTORY' && !dropped) { dropped = e; return true; } return false; };
      const req = await request(); const first = await post(app, req);
      try {
        await eventually(() => Promise.resolve(dropped), Boolean); assert.equal(await stock(req), 10);
        assert.equal((await broker.status(first.body.order.id)).saga.status, 'COMPENSATING');
        await expire(first.body.order.id); await recover(first.body.order.id);
        const final = await finish(first.body.order.id, 'FAILED'); assert.deepEqual(final.saga.compensatedSteps, ['INVENTORY', 'PAYMENT']);
        assert.equal(await stock(req), 10);
      } finally { shippingMode = 'success'; dropResult = undefined; }
    });
    await t.test('lost finalization result completes without compensating finalized inventory', async () => {
      let dropped;
      dropResult = e => { if (e.body.operation === 'FINALIZE_INVENTORY' && !dropped) { dropped = e; return true; } return false; };
      const req = await request(); const first = await post(app, req);
      try {
        await eventually(() => Promise.resolve(dropped), Boolean);
        assert.equal((await row('INVENTORY', 'reservations', first.body.order.id)).status, 'FINALIZED');
        await expire(first.body.order.id); await recover(first.body.order.id);
        const final = await finish(first.body.order.id); assert.deepEqual(final.saga.compensatedSteps, []); assert.equal(await stock(req), 8);
      } finally { dropResult = undefined; }
    });
    await t.test('unpublished commands wait for the relay without consuming recovery retries', async () => {
      await orderWorker.stop();
      const first = await post(app, await request());
      await dbs.ORDER.pool.query("UPDATE saga_instances SET next_attempt_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id);
      const pending = await broker.status(first.body.order.id);
      assert.equal(pending.saga.recoveryAttempts, 0); assert.equal(pending.saga.attempts, 1);
      assert.equal(pending.saga.pendingMessageId, first.body.saga.pendingMessageId);
      assert.equal(pending.saga.interventionReason, null);
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('competing workers claim once and expired lease owners are fenced out', async () => {
      await orderWorker.stop(); const first = await post(app, await request()); await expire(first.body.order.id);
      const other = new BrokerOrderService(dbs.ORDER.pool, 50, 1000);
      const groups = await Promise.all([broker.claimRecovery(100), other.claimRecovery(100)]);
      const claims = groups.flat().filter(c => c.orderId === first.body.order.id); assert.equal(claims.length, 1);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET lease_expires_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      const replacement = (await other.claimRecovery(100)).find(c => c.orderId === first.body.order.id); assert.ok(replacement);
      const before = await broker.status(first.body.order.id);
      await broker.recoverClaim(first.body.order.id, claims[0].token);
      assert.equal((await broker.status(first.body.order.id)).saga.version, before.saga.version);
      await other.recoverClaim(first.body.order.id, replacement.token);
      assert.equal((await broker.status(first.body.order.id)).saga.recoveryAttempts, 1);
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('a result arriving after a lease claim invalidates stale recovery work', async () => {
      let dropped; dropResult = e => { if (!dropped) { dropped = e; return true; } return false; };
      const first = await post(app, await request());
      try {
        await eventually(() => Promise.resolve(dropped), Boolean); await expire(first.body.order.id);
        const claim = (await broker.claimRecovery(100)).find(c => c.orderId === first.body.order.id);
        await broker.receive(dropped);
        const after = await broker.status(first.body.order.id);
        await broker.recoverClaim(first.body.order.id, claim.token);
        const state = await broker.status(first.body.order.id); assert.equal(state.saga.recoveryAttempts, 0);
        assert.ok(state.saga.version >= after.saga.version);
        await finish(first.body.order.id);
      } finally { dropResult = undefined; }
    });
    await t.test('repeated missing responses surface intervention and explicit resume safely restarts', async () => {
      dropResult = e => e.body.operation === 'CHARGE_PAYMENT';
      const first = await post(app, await request());
      try {
        for (let n = 0; n < 3; n++) {
          await eventually(() => row('PAYMENT', 'payments', first.body.order.id), Boolean);
          await expire(first.body.order.id); await recover(first.body.order.id);
        }
        const state = await broker.status(first.body.order.id);
        assert.equal(state.saga.interventionReason, 'RECOVERY_RETRIES_EXHAUSTED'); assert.equal(state.requiresManualIntervention, true);
        assert.equal(state.saga.status, 'IN_PROGRESS');
        assert.ok(!(await broker.claimRecovery(100)).some(c => c.orderId === first.body.order.id));
        const attention = await (await app.request('/orders/attention')).json(); assert.ok(attention.orders.some(o => o.orderId === first.body.order.id));
      } finally { dropResult = undefined; }
      await app.request(`/orders/${first.body.order.id}/resume`, { method: 'POST' }); await finish(first.body.order.id);
      assert.equal((await broker.status(first.body.order.id)).requiresManualIntervention, false);
    });
    await t.test('corrupt progress is flagged rather than dispatching skipped business steps', async () => {
      await orderWorker.stop(); const first = await post(app, await request());
      await dbs.ORDER.pool.query("UPDATE saga_instances SET current_operation='CREATE_SHIPMENT',current_step='SHIPPING',next_attempt_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id);
      assert.equal((await broker.status(first.body.order.id)).saga.interventionReason, 'INCONSISTENT_PROGRESS');
      assert.equal(await row('SHIPPING', 'shipments', first.body.order.id), undefined);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET current_operation='CHARGE_PAYMENT',current_step='PAYMENT' WHERE order_id=$1", [first.body.order.id]);
      await broker.run(first.body.order.id); orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('a legacy pending saga with no outbox resumes automatically', async () => {
      await orderWorker.stop(); const first = await post(app, await request());
      await dbs.ORDER.pool.query('DELETE FROM message_outbox WHERE id=$1', [first.body.saga.pendingMessageId]);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET pending_message_id=null,broker_attempts=0,next_attempt_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id); orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('a newly published command gets its full response deadline', async () => {
      await orderWorker.stop(); const first = await post(app, await request());
      await dbs.ORDER.pool.query('UPDATE message_outbox SET published_at=now() WHERE id=$1', [first.body.saga.pendingMessageId]);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET next_attempt_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id);
      const pending = await broker.status(first.body.order.id);
      assert.equal(pending.saga.recoveryAttempts, 0); assert.equal(pending.saga.pendingMessageId, first.body.saga.pendingMessageId);
      assert.ok(new Date(pending.saga.responseDeadlineAt) > new Date());
      await expire(first.body.order.id); await recover(first.body.order.id);
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('missing command records are flagged and resume rebuilds a valid command', async () => {
      await orderWorker.stop(); const first = await post(app, await request());
      await dbs.ORDER.pool.query('DELETE FROM message_outbox WHERE id=$1', [first.body.saga.pendingMessageId]);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET next_attempt_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id);
      assert.equal((await broker.status(first.body.order.id)).saga.interventionReason, 'MISSING_COMMAND');
      await broker.run(first.body.order.id);
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('failed recovery outbox commit retains prior progress and an expiring lease', async () => {
      await orderWorker.stop(); const first = await post(app, await request()); await expire(first.body.order.id);
      const claim = (await broker.claimRecovery(100)).find(c => c.orderId === first.body.order.id);
      await dbs.ORDER.pool.query("CREATE FUNCTION reject_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$");
      await dbs.ORDER.pool.query('CREATE TRIGGER reject_recovery BEFORE INSERT ON message_outbox FOR EACH ROW EXECUTE FUNCTION reject_recovery()');
      try { await assert.rejects(broker.recoverClaim(first.body.order.id, claim.token)); }
      finally { await dbs.ORDER.pool.query('DROP TRIGGER reject_recovery ON message_outbox'); await dbs.ORDER.pool.query('DROP FUNCTION reject_recovery()'); }
      const pending = await broker.status(first.body.order.id);
      assert.equal(pending.saga.pendingMessageId, first.body.saga.pendingMessageId); assert.equal(pending.saga.recoveryAttempts, 0);
      assert.equal(pending.saga.leaseOwner, claim.token);
      assert.equal(pending.transitions.length, pending.saga.version);
      await dbs.ORDER.pool.query("UPDATE saga_instances SET lease_expires_at=now()-interval '1 second' WHERE order_id=$1", [first.body.order.id]);
      await recover(first.body.order.id);
      orderWorker = makeWorker('orders'); orderWorker.start(); await finish(first.body.order.id);
    });
    await t.test('readiness tracks DB, broker and recovery, while health remains liveness', async () => {
      recovery.start();
      await eventually(() => Promise.resolve(recovery.isReady() && orderWorker.isReady()), Boolean);
      const monitored = createApp(broker, readiness(dbs.ORDER.pool, orderWorker, recovery));
      assert.equal((await monitored.request('/ready')).status, 200);
      await recovery.stop(); assert.equal((await monitored.request('/ready')).status, 503);
      assert.equal((await monitored.request('/health')).status, 200);
      const badDatabase = { query: async () => { throw new Error('unavailable'); } };
      const down = createApp(broker, readiness(badDatabase, orderWorker)); assert.equal((await down.request('/ready')).status, 503);
      await orderWorker.stop(); const disconnected = createApp(broker, readiness(dbs.ORDER.pool, orderWorker)); assert.equal((await disconnected.request('/ready')).status, 503);
      orderWorker = makeWorker('orders'); orderWorker.start();
    });
    await t.test('readable history and structured logs carry correlation without customer payloads', async () => {
      const first = await post(app, await request()); await finish(first.body.order.id);
      const history = await (await app.request(`/orders/${first.body.order.id}/history`)).json();
      assert.ok(history.history.every(h => typeof h.summary === 'string')); assert.equal(history.status, 'COMPLETED');
      assert.ok(!JSON.stringify(history).includes('shippingAddress'));
      assert.ok(logs.some(l => l.event === 'message_processed' && l.orderId === first.body.order.id && l.sagaId && l.messageId));
      const lines = []; structuredLogger('test', line => lines.push(line))({ event: 'test', orderId: first.body.order.id, password: 'secret', payload: { address: 'private' } });
      const parsed = JSON.parse(lines[0]); assert.equal(parsed.service, 'test'); assert.ok(parsed.timestamp);
      assert.ok(!lines[0].includes('secret')); assert.ok(!lines[0].includes('private'));
      assert.equal((await app.request('/orders/not-a-uuid/history')).status, 400);
      assert.equal((await app.request(`/orders/${randomUUID()}/history`)).status, 404);
    });
  } finally {
    for (const recovery of recoveries) await recovery.stop();
    for (const worker of workers) await worker.stop();
    if (connection) {
      const cleanup = await connection.createChannel();
      for (const name of ['payment', 'inventory', 'shipping', 'orders']) for (const suffix of ['', '.retry', '.dead']) await cleanup.deleteQueue(`${prefix}.${name}${suffix}`);
      await cleanup.deleteExchange(prefix); await cleanup.deleteExchange(`${prefix}.dead`); await connection.close();
    }
    for (const fixture of fixtures.reverse()) {
      await fixture.pool?.end(); await fixture.providerPool?.end();
      if (fixture.created) await fixture.admin.query(`DROP DATABASE "${fixture.name}"`);
      await fixture.admin.end();
    }
  }
});
