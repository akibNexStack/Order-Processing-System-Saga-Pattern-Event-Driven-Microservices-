import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedInventory, inventorySeed } from '../../services/inventory-service/dist/db/seed.js';

const fingerprint = 'a'.repeat(64);
const address = { recipient: 'Test', line1: 'Road 1', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' };
const fixtures = [
  ['payment-service', 'PAYMENT', ['command_receipts', 'payments', 'refunds', 'simulated_provider_payments', 'simulated_provider_requests'], 'CHARGE_PAYMENT'],
  ['inventory-service', 'INVENTORY', ['command_receipts', 'products', 'reservation_items', 'reservations'], 'RESERVE_INVENTORY'],
  ['shipping-service', 'SHIPPING', ['command_receipts', 'shipment_cancellations', 'shipments', 'simulated_provider_requests', 'simulated_provider_shipments'], 'CREATE_SHIPMENT'],
  ['order-orchestrator', 'ORDER', ['order_items', 'orders', 'saga_instances', 'saga_transitions'], null],
];
const rejects = (pool, sql, values, code) => assert.rejects(pool.query(sql, values), (error) => error.code === code);

for (const [service, prefix, tables, operation] of fixtures) {
  test(`${service}: migrations and database invariants`, async (t) => {
    const envPath = new URL(`../../services/${service}/.env`, import.meta.url);
    const configured = process.env[`TEST_${prefix}_DATABASE_URL`] ?? parse(readFileSync(envPath)).DATABASE_URL;
    if (!configured) throw new Error(`Missing TEST_${prefix}_DATABASE_URL or service DATABASE_URL`);
    const url = new URL(configured);
    const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    const databaseName = `saga_test_${randomUUID().replaceAll('-', '')}`;
    let pool;
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      url.pathname = `/${databaseName}`;
      pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
      const db = drizzle(pool);
      const migrationsFolder = fileURLToPath(new URL(`../../services/${service}/drizzle/`, import.meta.url));
      await t.test('migrates a fresh database and reruns without duplicate migrations', async () => {
        await migrate(db, { migrationsFolder });
        const before = await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
        assert.ok(before.rows[0].count > 0);
        await migrate(db, { migrationsFolder });
        assert.deepEqual((await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows, before.rows);
        const actual = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
        assert.deepEqual(actual.rows.map(r => r.tablename), [...tables, 'message_inbox', 'message_outbox'].sort());
      });

      if (operation) {
        await t.test('concurrent insert-first deduplication permits exactly one winner', async () => {
          const args = [randomUUID(), randomUUID(), randomUUID(), operation, fingerprint];
          const sql = 'INSERT INTO command_receipts (idempotency_key,order_id,saga_id,operation,fingerprint) VALUES ($1,$2,$3,$4,$5)';
          const outcomes = await Promise.allSettled([pool.query(sql, args), pool.query(sql, args)]);
          assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
          assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, '23505');
          await rejects(pool, 'UPDATE command_receipts SET status=\'COMPLETED\' WHERE idempotency_key=$1', [args[0]], '23514');
          await rejects(pool, sql, [randomUUID(), randomUUID(), randomUUID(), 'WRONG_OPERATION', fingerprint], '23514');
          await rejects(pool, sql, [randomUUID(), randomUUID(), randomUUID(), operation, 'invalid'], '23514');
        });
      }

      if (prefix === 'PAYMENT') {
        await t.test('payment amounts, currency, order uniqueness, and refund ownership', async () => {
          const order = randomUUID();
          const args = [order, randomUUID(), randomUUID(), 9_999_999_999, 'BDT'];
          const sql = 'INSERT INTO payments (order_id,saga_id,customer_id,amount_minor,currency) VALUES ($1,$2,$3,$4,$5) RETURNING id,amount_minor';
          const payment = (await pool.query(sql, args)).rows[0];
          assert.equal(payment.amount_minor, '9999999999');
          await rejects(pool, sql, args, '23505');
          for (const amount of [0, -1, 10_000_000_000]) await rejects(pool, sql, [randomUUID(), args[1], args[2], amount, 'BDT'], '23514');
          await rejects(pool, sql, [randomUUID(), args[1], args[2], 100, 'XYZ'], '23514');
          await rejects(pool, "UPDATE payments SET status='CHARGED' WHERE id=$1", [payment.id], '23514');
          await pool.query("UPDATE payments SET status='CHARGED',provider_transaction_id=$2 WHERE id=$1", [payment.id, randomUUID()]);
          await pool.query("INSERT INTO refunds(order_id,saga_id,payment_id,status) VALUES ($1,$2,$3,'REFUNDED')", [order, args[1], payment.id]);
          await rejects(pool, 'INSERT INTO refunds(order_id,saga_id,payment_id) VALUES ($1,$2,$3)', [randomUUID(), args[1], payment.id], '23503');
          await pool.query("INSERT INTO refunds(order_id,saga_id,status) VALUES ($1,$2,'NOOP')", [randomUUID(), randomUUID()]);
          await rejects(pool, "UPDATE payments SET status='REFUNDED' WHERE id=$1", [payment.id], '23514');
          await pool.query("UPDATE payments SET status='REFUNDED',refunded_at=now() WHERE id=$1", [payment.id]);
        });
      }

      if (prefix === 'INVENTORY') {
        await t.test('seed is repeatable and never replenishes consumed stock', async () => {
          await seedInventory(db);
          await pool.query('UPDATE products SET available_stock=7 WHERE id=$1', [inventorySeed[0].id]);
          await seedInventory(db);
          assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n, 3);
          assert.equal((await pool.query('SELECT available_stock FROM products WHERE id=$1', [inventorySeed[0].id])).rows[0].available_stock, 7);
        });
        await t.test('stock and reservation constraints reject invalid or orphaned data', async () => {
          const product = inventorySeed[0].id;
          await rejects(pool, 'UPDATE products SET available_stock=-1 WHERE id=$1', [product], '23514');
          const order = randomUUID();
          const args = [order, randomUUID()];
          const sql = 'INSERT INTO reservations(order_id,saga_id) VALUES ($1,$2) RETURNING id';
          const reservation = (await pool.query(sql, args)).rows[0].id;
          await rejects(pool, sql, args, '23505');
          const insert = 'INSERT INTO reservation_items(reservation_id,product_id,quantity) VALUES ($1,$2,$3)';
          await rejects(pool, insert, [reservation, product, 0], '23514');
          await rejects(pool, insert, [reservation, randomUUID(), 1], '23503');
          await pool.query(insert, [reservation, product, 2]);
          await rejects(pool, insert, [reservation, product, 2], '23505');
          await rejects(pool, 'DELETE FROM products WHERE id=$1', [product], '23503');
          await rejects(pool, "UPDATE reservations SET expires_at=created_at-interval '1 minute' WHERE id=$1", [reservation], '23514');
        });
        await t.test('transaction rollback preserves stock and conditional concurrent updates cannot oversell', async () => {
          const product = inventorySeed[1].id;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('UPDATE products SET available_stock=1 WHERE id=$1', [product]);
            await client.query('ROLLBACK');
          } finally { client.release(); }
          assert.equal((await pool.query('SELECT available_stock FROM products WHERE id=$1', [product])).rows[0].available_stock, 50);
          const outcomes = await Promise.all(Array.from({ length: 8 }, () => pool.query('UPDATE products SET available_stock=available_stock-10 WHERE id=$1 AND available_stock>=10 RETURNING id', [product])));
          assert.equal(outcomes.reduce((n, r) => n + r.rowCount, 0), 5);
          assert.equal((await pool.query('SELECT available_stock FROM products WHERE id=$1', [product])).rows[0].available_stock, 0);
        });
      }

      if (prefix === 'SHIPPING') {
        await t.test('shipment uniqueness, JSON shape, lifecycle, and cancellation ownership', async () => {
          const args = [randomUUID(), randomUUID(), JSON.stringify(address), JSON.stringify([{ productId: randomUUID(), quantity: 1 }])];
          const sql = 'INSERT INTO shipments(order_id,saga_id,shipping_address,items) VALUES ($1,$2,$3,$4) RETURNING id';
          const id = (await pool.query(sql, args)).rows[0].id;
          await rejects(pool, sql, args, '23505');
          await rejects(pool, sql, [randomUUID(), args[1], '[]', args[3]], '23514');
          await rejects(pool, sql, [randomUUID(), args[1], args[2], '[]'], '23514');
          await rejects(pool, sql, [randomUUID(), args[1], args[2], '{}'], '23514');
          await rejects(pool, "UPDATE shipments SET status='CREATED' WHERE id=$1", [id], '23514');
          await pool.query("UPDATE shipments SET status='CREATED',provider_shipment_id=$2 WHERE id=$1", [id, randomUUID()]);
          await rejects(pool, 'INSERT INTO shipment_cancellations(order_id,saga_id,shipment_id) VALUES ($1,$2,$3)', [randomUUID(), args[1], id], '23503');
          await pool.query("INSERT INTO shipment_cancellations(order_id,saga_id,shipment_id,status) VALUES ($1,$2,$3,'CANCELLED')", [args[0], args[1], id]);
          await pool.query("INSERT INTO shipment_cancellations(order_id,saga_id,status) VALUES ($1,$2,'NOOP')", [randomUUID(), randomUUID()]);
          await rejects(pool, "UPDATE shipments SET status='CANCELLED' WHERE id=$1", [id], '23514');
          await pool.query("UPDATE shipments SET status='CANCELLED',cancelled_at=now() WHERE id=$1", [id]);
        });
      }

      if (prefix === 'ORDER') {
        await t.test('checkout keys are customer scoped and order items enforce references', async () => {
          const args = [randomUUID(), 'checkout-one', fingerprint, 100, 'USD', JSON.stringify(address)];
          const sql = 'INSERT INTO orders(customer_id,idempotency_key,fingerprint,amount_minor,currency,shipping_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id';
          const id = (await pool.query(sql, args)).rows[0].id;
          await rejects(pool, sql, args, '23505');
          await pool.query(sql, [randomUUID(), ...args.slice(1)]);
          await rejects(pool, sql, [randomUUID(), args[1], fingerprint, 0, 'USD', args[5]], '23514');
          const insert = 'INSERT INTO order_items(order_id,product_id,quantity) VALUES ($1,$2,$3)';
          const product = randomUUID();
          await pool.query(insert, [id, product, 1]);
          await rejects(pool, insert, [id, product, 1], '23505');
          await rejects(pool, insert, [randomUUID(), product, 1], '23503');
          await rejects(pool, insert, [id, randomUUID(), 10001], '23514');
        });
        await t.test('saga state and transition history persist with valid references and ordering', async () => {
          const order = (await pool.query('SELECT id FROM orders LIMIT 1')).rows[0].id;
          const sql = 'INSERT INTO saga_instances(order_id,payload) VALUES ($1,$2) RETURNING *';
          const saga = (await pool.query(sql, [order, '{}'])).rows[0];
          assert.equal(saga.status, 'IN_PROGRESS');
          assert.equal(saga.current_step, 'PAYMENT');
          assert.deepEqual(saga.completed_steps, []);
          await rejects(pool, sql, [order, '{}'], '23505');
          await rejects(pool, sql, [randomUUID(), '{}'], '23503');
          await rejects(pool, "UPDATE saga_instances SET status='BOGUS' WHERE id=$1", [saga.id], '23514');
          await rejects(pool, "UPDATE saga_instances SET completed_steps='[\"BOGUS\"]' WHERE id=$1", [saga.id], '23514');
          await rejects(pool, "UPDATE saga_instances SET compensated_steps='[\"PAYMENT\"]' WHERE id=$1", [saga.id], '23514');
          await rejects(pool, "UPDATE saga_instances SET lease_owner='worker' WHERE id=$1", [saga.id], '23514');
          const transition = "INSERT INTO saga_transitions(saga_id,sequence,to_status,step,direction) VALUES ($1,$2,'IN_PROGRESS','PAYMENT','FORWARD')";
          await pool.query(transition, [saga.id, 1]);
          await rejects(pool, transition, [saga.id, 1], '23505');
          await rejects(pool, transition, [saga.id, 0], '23514');
          await rejects(pool, transition, [randomUUID(), 2], '23503');
          const updates = await Promise.all(Array.from({ length: 2 }, () => pool.query('UPDATE saga_instances SET version=version+1 WHERE id=$1 AND version=0 RETURNING id', [saga.id])));
          assert.equal(updates.reduce((n, r) => n + r.rowCount, 0), 1);
        });
      }
    } finally {
      await pool?.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  });
}
