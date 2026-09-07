import 'dotenv/config';
import { createDatabase } from './client.js';
import { seedInventory } from './seed.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before seeding inventory.');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  await seedInventory(db);
  console.log('Inventory seed applied; existing products and stock preserved.');
} finally {
  await pool.end();
}
