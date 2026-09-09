import { RabbitWorker, participantHandler, readiness, structuredLogger } from '@saga/shared/messaging';
import type { CommandFor } from '@saga/shared';
import 'dotenv/config';
import { protectService } from '@saga/shared/http';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { InventoryService } from './inventory/service.js';

const log = structuredLogger('inventory-service');
const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3002);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
const service = new InventoryService(pool);
const server = serve({ fetch: protectService(createApp(service, () => readiness(pool, messaging)()).fetch), port }, info => {
  log({ event: 'http_started' });
});
const messaging = new RabbitWorker(pool, 'inventory', participantHandler(pool, 'inventory',
  (command, commit) => service.execute(command as CommandFor<'RESERVE_INVENTORY' | 'RELEASE_INVENTORY' | 'FINALIZE_INVENTORY'>, commit)), {
  url: process.env.RABBITMQ_URL ?? 'amqp://saga:saga@localhost:5672',
  prefix: process.env.RABBITMQ_PREFIX ?? 'saga.v1',
  log,
  onError: () => log({ event: 'messaging_error' }),
});
messaging.start();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void messaging.stop().then(() => pool.end()); });
  });
}
server.on('error', (error: NodeJS.ErrnoException) => {
  log({ event: 'http_start_failed', reason: error.code ?? 'SERVER_ERROR' });
  void messaging.stop().then(() => pool.end()).finally(() => { process.exitCode = 1; });
});
