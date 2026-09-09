import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Call explicitly at startup so importing schemas never opens connections.
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  // Idle sockets can fail during a database restart. pg removes the failed
  // client; handle the event so the process survives and can reconnect.
  // Never log the raw error: it may include connection details or SQL.
  pool.on('error', () => console.error(JSON.stringify({ event: 'database_pool_error', reason: 'IDLE_CONNECTION_LOST' })));
  return { db: drizzle(pool, { schema }), pool };
}
