import 'dotenv/config';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createApp } from './app.js';
import { createDatabase } from './db/client.js';
import { ShippingService } from './shipments/service.js';
import { LocalShippingProvider } from './providers/local-provider.js';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3003);
const databaseUrl = z.string().min(1).parse(process.env.DATABASE_URL);
const mode = z.enum(['success', 'reject', 'timeout-after-success']).parse(process.env.SHIPPING_SIMULATION_MODE ?? 'success');
const timeout = z.coerce.number().int().min(1).max(60000).parse(process.env.SHIPPING_PROVIDER_TIMEOUT_MS ?? 5000);
// Separate pools prevent provider calls from waiting on connections held by callers.
const { pool } = createDatabase(databaseUrl);
const { pool: providerPool } = createDatabase(databaseUrl);
const app = createApp(new ShippingService(pool, new LocalShippingProvider(providerPool, mode), timeout));
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`shipping-service listening on port ${info.port} (local simulated provider: ${mode})`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void Promise.all([pool.end(), providerPool.end()]); });
  });
}
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`shipping-service could not start: ${error.code ?? 'server error'}`);
  void Promise.all([pool.end(), providerPool.end()]).finally(() => { process.exitCode = 1; });
});
