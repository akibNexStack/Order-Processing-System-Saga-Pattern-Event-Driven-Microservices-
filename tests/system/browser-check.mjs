import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { seedInventory } from '../../services/inventory-service/dist/db/seed.js';
import * as schema from '../../services/inventory-service/dist/db/schema.js';

export async function checkBrowser({ services, dbs, children, freePort, poll, finish, payment, stop }) {
  await seedInventory(drizzle(dbs.inventory.pool, { schema }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const info = { output: '' };
  info.child = fork(fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url)),
    ['start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, VERCEL: '', BACKEND_API_TOKEN: '',
        ORDERS_SERVICE_URL: services.orders.base, PAYMENT_SERVICE_URL: services.payment.base,
        INVENTORY_SERVICE_URL: services.inventory.base, SHIPPING_SERVICE_URL: services.shipping.base },
    });
  info.exited = new Promise(resolve => info.child.once('exit', resolve));
  for (const stream of [info.child.stdout, info.child.stderr])
    stream.on('data', chunk => { info.output = (info.output + chunk).slice(-8000); });
  children.push(info);
  let browser;
  try {
    await poll(async () => {
      assert.equal(info.child.exitCode, null, info.output);
      try { return (await fetch(base, { signal: AbortSignal.timeout(2000) })).status; } catch { return 0; }
    }, status => status === 200, 60000);
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const fill = async (product = 'Demo Keyboard') => {
      await page.goto(base + '/orders/new');
      for (const [name, value] of Object.entries({
        'Customer ID': '11111111-1111-4111-8111-111111111111', Amount: '0.29',
        Recipient: 'Release Test', 'Address line 1': '10 Test Road', City: 'Dhaka',
        'Postal code': '1200', 'Country code': 'BD',
      })) await page.getByRole('textbox', { name, exact: true }).fill(value);
      await page.getByRole('checkbox', { name: new RegExp(product) }).check();
    };
    const writes = [];
    let lost = true;
    await page.route('**/api/orders', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      writes.push(route.request().postDataJSON());
      // Execute the real request and discard only the response reaching the browser.
      if (lost) {
        lost = false;
        const accepted = await route.fetch();
        assert.ok([200, 201, 202].includes(accepted.status()));
        await route.abort('failed');
      } else await route.continue();
    });
    await fill();
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await page.getByRole('button', { name: 'Retry original request' }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    const id = new URL(page.url()).pathname.split('/').at(-1);
    const final = await finish(id);
    assert.equal(final.body.saga.inventoryFinalized, true);
    assert.equal((await payment(id)).status, 'CHARGED');
    assert.equal((await dbs.orders.pool.query('SELECT count(*)::int AS n FROM orders WHERE idempotency_key=$1', [writes[0].idempotencyKey])).rows[0].n, 1);
    assert.equal((await dbs.shipping.pool.query('SELECT status FROM shipments WHERE order_id=$1', [id])).rows[0].status, 'CREATED');
    await page.reload();
    await expect(page.getByText('COMPLETED', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume order', exact: true })).toHaveCount(0);
    const before = final.body.saga.version;
    const resumed = await page.request.post(base + '/api/orders/' + id + '/resume');
    assert.equal(resumed.status(), 200);
    assert.equal((await resumed.json()).saga.version, before);

    await fill('Demo Monitor');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    const failedId = new URL(page.url()).pathname.split('/').at(-1);
    await finish(failedId, 'FAILED');
    assert.equal((await payment(failedId)).status, 'REFUNDED');
    await page.reload();
    await expect(page.getByText('FAILED', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume order', exact: true })).toHaveCount(0);
    for (const path of ['/', '/orders', '/attention', '/services']) {
      const response = await page.goto(base + path);
      assert.equal(response.status(), 200);
      await expect(page.getByRole('main')).toBeVisible();
    }
  } finally {
    await browser?.close();
    await stop(info);
  }
}
