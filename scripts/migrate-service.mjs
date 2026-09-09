import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const service = process.argv[2];
if (!['payment-service', 'inventory-service', 'shipping-service', 'order-orchestrator'].includes(service))
  throw new Error('Unknown service');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
pool.on('error', () => console.error('Migration database connection lost'));
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL(`../services/${service}/drizzle/`, import.meta.url)) });
  if (service === 'inventory-service') {
    const { seedInventory } = await import('../services/inventory-service/dist/db/seed.js');
    const schema = await import('../services/inventory-service/dist/db/schema.js');
    await seedInventory(drizzle(pool, { schema }));
  }
  console.log(`${service}: migration complete`);
} catch {
  throw new Error(`${service}: migration failed; check database availability and migration compatibility`);
} finally { await pool.end(); }
