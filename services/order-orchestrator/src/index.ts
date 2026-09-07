import 'dotenv/config';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { OrderService } from './orders/service.js';
import { HttpTransport } from './saga/httpTransport.js';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3000);
const httpUrl = z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Expected HTTP(S) service URL');
const urls = {
  payment: httpUrl.parse(process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3001'),
  inventory: httpUrl.parse(process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:3002'),
  shipping: httpUrl.parse(process.env.SHIPPING_SERVICE_URL ?? 'http://localhost:3003'),
};
const timeout = z.coerce.number().int().min(1).max(60000).parse(process.env.SERVICE_TIMEOUT_MS ?? 10000);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
const server = serve({ fetch: createApp(new OrderService(pool, new HttpTransport(urls, timeout))).fetch, port }, info => {
  console.log(`order-orchestrator listening on port ${info.port}`);
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
  console.error(`order-orchestrator could not start: ${error.code ?? 'server error'}`);
  void pool.end().finally(() => { process.exitCode = 1; });
});
