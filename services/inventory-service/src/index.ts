import 'dotenv/config';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { InventoryService } from './inventory/service.js';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3002);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
const server = serve({ fetch: createApp(new InventoryService(pool)).fetch, port }, info => {
  console.log(`inventory-service listening on port ${info.port}`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void pool.end(); });
  });
}
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`inventory-service could not start: ${error.code ?? 'server error'}`);
  void pool.end().finally(() => { process.exitCode = 1; });
});
