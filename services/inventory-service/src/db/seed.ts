import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { products } from './schema.js';
import type * as schema from './schema.js';

export const inventorySeed = [
  { id: '44444444-4444-4444-8444-444444444444', sku: 'DEMO-KEYBOARD', name: 'Demo Keyboard', availableStock: 100 },
  { id: '55555555-5555-4555-8555-555555555555', sku: 'DEMO-MOUSE', name: 'Demo Mouse', availableStock: 50 },
  { id: '66666666-6666-4666-8666-666666666666', sku: 'DEMO-MONITOR', name: 'Demo Monitor', availableStock: 0 },
] as const;

export async function seedInventory(db: NodePgDatabase<typeof schema>): Promise<void> {
  // Never replenish existing stock on rerun; reservations may already have consumed it.
  await db.transaction(async (tx) => {
    for (const product of inventorySeed) {
      await tx.insert(products).values(product).onConflictDoNothing();
    }
  });
}
