import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Call explicitly at startup so importing schemas never opens connections.
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  return { db: drizzle(pool, { schema }), pool };
}
