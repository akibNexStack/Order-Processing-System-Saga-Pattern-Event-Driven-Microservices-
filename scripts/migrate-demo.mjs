import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedInventory } from '../services/inventory-service/dist/db/seed.js';
import * as inventorySchema from '../services/inventory-service/dist/db/schema.js';

for (const [service, key] of [
  ['payment-service', 'PAYMENT'], ['inventory-service', 'INVENTORY'],
  ['shipping-service', 'SHIPPING'], ['order-orchestrator', 'ORDER'],
]) {
  const connectionString = process.env[`${key}_DATABASE_URL`];
  if (!connectionString) throw new Error(`Missing ${key}_DATABASE_URL`);
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', () => console.error('Migration database connection lost'));
  try {
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL(`../services/${service}/drizzle/`, import.meta.url)) });
    if (key === 'INVENTORY') await seedInventory(drizzle(pool, { schema: inventorySchema }));
    console.log(`${service}: migration complete`);
  } catch {
    // Keep credentials/SQL out of deployment logs.
    throw new Error(`${service}: migration failed; inspect database availability and migration compatibility`);
  } finally { await pool.end(); }
}
