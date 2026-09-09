import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import pg from 'pg';
import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const exec = promisify(execFile);
const docker = (...args) => exec('docker', args, { timeout: 90000, maxBuffer: 1024 * 1024 });
const poll = async (read, predicate, timeout = 45000) => {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for system state: ${JSON.stringify(value)}`);
};
const freePort = async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
const get = async url => {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); return { status: response.status, body: await response.json() }; }
  catch { return { status: 0 }; }
};

test('Independent service processes, crash recovery and isolated broker restart', { timeout: 480000 }, async t => {
  const fixtures = [], children = [], services = {}, dbs = {};
  const container = `saga-system-test-${randomUUID()}`;
  const prefix = `saga.system.${randomUUID()}`;
  let containerCreated = false, brokerUrl;
  const stop = async (processInfo, signal = 'SIGTERM') => {
    if (!processInfo || processInfo.child.exitCode !== null || processInfo.child.signalCode !== null) return;
    processInfo.child.kill(signal);
    let timer;
    try {
      await Promise.race([processInfo.exited, new Promise(resolve => { timer = setTimeout(() => { processInfo.child.kill('SIGKILL'); resolve(); }, 5000); })]);
      await processInfo.exited;
    } finally { clearTimeout(timer); }
  };
  try {
    // This container belongs only to this test. The user's development broker is untouched.
    await docker('run', '-d', '--name', container, '-p', '127.0.0.1::5672',
      '-e', 'RABBITMQ_DEFAULT_USER=saga', '-e', 'RABBITMQ_DEFAULT_PASS=saga',
      '-e', 'RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=+S 2:2', 'rabbitmq:4-management');
    containerCreated = true;
    const mapped = (await docker('port', container, '5672/tcp')).stdout.trim();
    brokerUrl = `amqp://saga:saga@${mapped}`;
    for (const [name, key] of [['payment-service', 'payment'], ['inventory-service', 'inventory'], ['shipping-service', 'shipping'], ['order-orchestrator', 'orders']]) {
      const envKey = key === 'orders' ? 'ORDER' : key.toUpperCase();
      const url = new URL(process.env[`TEST_${envKey}_DATABASE_URL`] ?? parse(readFileSync(new URL(`../../services/${name}/.env`, import.meta.url))).DATABASE_URL);
      const fixture = { admin: new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 }), name: `saga_system_${randomUUID().replaceAll('-', '')}`, created: false }; fixtures.push(fixture);
      await fixture.admin.query(`CREATE DATABASE "${fixture.name}"`); fixture.created = true;
      url.pathname = `/${fixture.name}`;
      fixture.url = url.href; fixture.serviceName = name;
      fixture.pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 }); dbs[key] = fixture;
      await migrate(drizzle(fixture.pool), { migrationsFolder: fileURLToPath(new URL(`../../services/${name}/drizzle/`, import.meta.url)) });
    }
    const launch = async (name, extra = {}, fault) => {
      await stop(services[name]);
      const port = await freePort();
      const script = fault ? new URL('./fault-service.mjs', import.meta.url) : new URL(`../../services/${dbs[name].serviceName}/dist/index.js`, import.meta.url);
      const info = { output: '', events: [], base: `http://127.0.0.1:${port}` };
      const child = fork(fileURLToPath(script), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env,
        DATABASE_URL: dbs[name].url, RABBITMQ_URL: brokerUrl, RABBITMQ_PREFIX: prefix, PORT: String(port),
        PAYMENT_SIMULATION_MODE: 'success', SHIPPING_SIMULATION_MODE: 'success',
        SAGA_COMMAND_TIMEOUT_MS: '30000', RECOVERY_INTERVAL_MS: '100',
        SYSTEM_SERVICE: name, SYSTEM_FAULT_POINT: fault ?? '', ...extra } });
      info.child = child; info.exited = new Promise(resolve => child.once('exit', resolve));
      child.on('message', message => info.events.push(message));
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { info.output = (info.output + chunk).slice(-8000); });
      children.push(info); services[name] = info;
      await poll(async () => {
        assert.equal(child.exitCode, null, `Service exited: ${info.output}`);
        return get(`${info.base}/ready`);
      }, r => r.status === 200, 60000);
      return info;
    };
    await Promise.all(['payment', 'inventory', 'shipping', 'orders'].map(name => launch(name)));
    const request = async (quantity = 2, stock = 10, productId = randomUUID()) => {
      await dbs.inventory.pool.query("INSERT INTO products(id,sku,name,available_stock) VALUES ($1,$2,'System test',$3) ON CONFLICT DO NOTHING", [productId, productId, stock]);
      return { idempotencyKey: randomUUID(), payload: { customerId: randomUUID(), items: [{ productId, quantity }], amountMinor: 12500, currency: 'BDT',
        shippingAddress: { recipient: 'System Test', line1: '10 Road', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' } } };
    };
    const post = async req => {
      const r = await fetch(`${services.orders.base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(10000) });
      assert.ok([200, 201, 202, 422].includes(r.status), `Unexpected order response ${r.status}`);
      return r.json();
    };
    const state = id => get(`${services.orders.base}/orders/${id}`);
    const finish = (id, expected = 'COMPLETED') => poll(() => state(id), r => r.body?.saga.status === expected);
    const stock = async req => (await dbs.inventory.pool.query('SELECT available_stock FROM products WHERE id=$1', [req.payload.items[0].productId])).rows[0].available_stock;
    const payment = async id => (await dbs.payment.pool.query('SELECT * FROM payments WHERE order_id=$1', [id])).rows[0];

    if (process.env.SYSTEM_BROWSER_TEST === '1') {
      await t.test('real browser checkout, lost response retry, reload, compensation and terminal recovery guard', async () => {
        const { checkBrowser } = await import('./browser-check.mjs');
        await checkBrowser({ services, dbs, children, freePort, poll, finish, payment, stop });
      });
    }

    await t.test('production entrypoints expose readiness and complete the event-driven checkout', async () => {
      for (const service of Object.values(services)) assert.equal((await get(`${service.base}/ready`)).status, 200);
      const req = await request(); const first = await post(req); const final = await finish(first.order.id);
      assert.equal(final.body.saga.inventoryFinalized, true); assert.equal(await stock(req), 8);
      assert.equal((await payment(first.order.id)).status, 'CHARGED');
      assert.equal((await get(`${services.orders.base}/orders/${first.order.id}/history`)).status, 200);
    });
    await t.test('concurrent duplicate requests and competing orders conserve limited stock', async () => {
      const product = randomUUID(); const req = await request(1, 3, product);
      const duplicates = await Promise.all(Array.from({ length: 8 }, () => post(req)));
      assert.equal(new Set(duplicates.map(x => x.order.id)).size, 1); await finish(duplicates[0].order.id);
      const orders = await Promise.all(Array.from({ length: 5 }, async () => post(await request(1, 3, product))));
      const finals = await Promise.all(orders.map(o => poll(() => state(o.order.id), r => ['COMPLETED', 'FAILED'].includes(r.body?.saga.status))));
      assert.equal(finals.filter(r => r.body.saga.status === 'COMPLETED').length, 2); assert.equal(await stock(req), 0);
      for (const result of finals.filter(r => r.body.saga.status === 'FAILED')) assert.equal((await payment(result.body.order.id)).status, 'REFUNDED');
    });
    await t.test('forced payment, inventory and shipping failures leave correct terminal state', async () => {
      await launch('payment', { PAYMENT_SIMULATION_MODE: 'reject' });
      const declined = await post(await request()); const failed = await finish(declined.order.id, 'FAILED'); assert.deepEqual(failed.body.saga.completedSteps, []);
      await launch('payment');
      const empty = await post(await request(2, 0)); await finish(empty.order.id, 'FAILED'); assert.equal((await payment(empty.order.id)).status, 'REFUNDED');
      await launch('shipping', { SHIPPING_SIMULATION_MODE: 'reject' });
      const req = await request(); const rejected = await post(req); const result = await finish(rejected.order.id, 'FAILED');
      assert.deepEqual(result.body.saga.compensatedSteps, ['INVENTORY', 'PAYMENT']); assert.equal(await stock(req), 10);
      await launch('shipping');
    });
    for (const name of ['payment', 'inventory']) {
      await t.test(`failed ${name === 'payment' ? 'refund' : 'inventory release'} completion remains pending and retries safely`, async () => {
        await launch('shipping', { SHIPPING_SIMULATION_MODE: 'reject' });
        const table = name === 'payment' ? 'refunds' : 'reservations';
        const blockedStatus = name === 'payment' ? 'REFUNDED' : 'RELEASED';
        await dbs[name].pool.query(`CREATE FUNCTION block_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='${blockedStatus}' THEN RAISE EXCEPTION 'injected cleanup failure'; END IF; RETURN NEW; END $$`);
        await dbs[name].pool.query(`CREATE TRIGGER block_cleanup BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION block_cleanup()`);
        const req = await request(); let first;
        try {
          first = await post(req);
          await poll(() => Promise.resolve(services[name].output), output => output.split('\n').some(line => line.includes('"event":"message_retry_scheduled"') && line.includes(first.order.id)));
          assert.equal((await state(first.order.id)).body.saga.status, 'COMPENSATING');
          assert.equal((await payment(first.order.id)).status, 'CHARGED');
          assert.equal(await stock(req), name === 'inventory' ? 8 : 10);
        } finally {
          await dbs[name].pool.query(`DROP TRIGGER block_cleanup ON ${table}`);
          await dbs[name].pool.query('DROP FUNCTION block_cleanup()');
        }
        await finish(first.order.id, 'FAILED'); assert.equal((await payment(first.order.id)).status, 'REFUNDED'); assert.equal(await stock(req), 10);
        assert.equal((await dbs.payment.pool.query("SELECT count(*)::int n FROM simulated_provider_requests WHERE result->>'orderId'=$1", [first.order.id])).rows[0].n, 2);
        await launch('shipping');
      });
    }
    for (const point of ['before_commit', 'after_commit_before_ack']) {
      await t.test(`SIGKILL inventory ${point} recovers without duplicate stock changes`, async () => {
        const processInfo = await launch('inventory', {}, point);
        const req = await request(); const first = await post(req);
        await poll(() => Promise.resolve(processInfo.events), events => events.some(e => e.event === 'fault' && e.orderId === first.order.id));
        assert.equal(await stock(req), point === 'before_commit' ? 10 : 8);
        await stop(processInfo, 'SIGKILL'); await launch('inventory');
        await finish(first.order.id); assert.equal(await stock(req), 8);
        assert.equal((await payment(first.order.id)).status, 'CHARGED');
      });
    }
    await t.test('SIGKILL orchestrator after result commit before acknowledgement preserves the next command', async () => {
      const processInfo = await launch('orders', {}, 'after_commit_before_ack');
      const first = await post(await request());
      await poll(() => Promise.resolve(processInfo.events), events => events.some(e => e.event === 'fault' && e.orderId === first.order.id));
      await stop(processInfo, 'SIGKILL'); await launch('orders');
      const final = await finish(first.order.id);
      assert.deepEqual(final.body.saga.completedSteps, ['PAYMENT', 'INVENTORY', 'SHIPPING']);
      assert.equal((await dbs.payment.pool.query("SELECT count(*)::int n FROM simulated_provider_requests WHERE result->>'orderId'=$1", [first.order.id])).rows[0].n, 1);
    });
    await t.test('broker shutdown accepts durable orders and service restart republishes after broker restart', async () => {
      await docker('stop', '--time', '10', container);
      await poll(() => get(`${services.orders.base}/ready`), r => r.status === 503);
      assert.equal((await get(`${services.orders.base}/health`)).status, 200);
      const req = await request(); const first = await post(req);
      assert.equal(first.saga.status, 'IN_PROGRESS'); assert.equal(await payment(first.order.id), undefined);
      const pending = (await dbs.orders.pool.query('SELECT published_at FROM message_outbox WHERE id=$1', [first.saga.pendingMessageId])).rows[0];
      assert.equal(pending.published_at, null);
      await stop(services.orders, 'SIGKILL');
      await docker('start', container);
      // Docker may assign a different dynamic host port on restart.
      const mapped = (await docker('port', container, '5672/tcp')).stdout.trim();
      const restartedUrl = `amqp://saga:saga@${mapped}`;
      const changed = brokerUrl !== restartedUrl; brokerUrl = restartedUrl;
      if (changed) await Promise.all(['payment', 'inventory', 'shipping'].map(name => launch(name)));
      await launch('orders'); await finish(first.order.id); assert.equal(await stock(req), 8);
    });
    await t.test('broker restart preserves queued commands while a participant is offline', async () => {
      await stop(services.inventory, 'SIGKILL');
      const req = await request(); const first = await post(req);
      await poll(async () => (await dbs.orders.pool.query("SELECT o.published_at FROM message_outbox o JOIN saga_instances s ON s.pending_message_id=o.id WHERE s.order_id=$1 AND s.current_operation='RESERVE_INVENTORY'", [first.order.id])).rows[0], r => !!r?.published_at);
      await docker('stop', '--time', '10', container); await docker('start', container);
      const mapped = (await docker('port', container, '5672/tcp')).stdout.trim();
      const restartedUrl = `amqp://saga:saga@${mapped}`; const changed = brokerUrl !== restartedUrl; brokerUrl = restartedUrl;
      if (changed) await Promise.all(['payment', 'shipping', 'orders'].map(name => launch(name)));
      await launch('inventory'); await finish(first.order.id); assert.equal(await stock(req), 8);
    });
  } finally {
    await Promise.all(children.map(child => stop(child, 'SIGKILL')));
    if (containerCreated) await docker('rm', '-f', '-v', container);
    for (const fixture of fixtures.reverse()) {
      await fixture.pool?.end();
      if (fixture.created) await fixture.admin.query(`DROP DATABASE "${fixture.name}" WITH (FORCE)`);
      await fixture.admin.end();
    }
  }
});
