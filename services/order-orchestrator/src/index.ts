import { RecoveryWorker } from './saga/recoveryWorker.js';
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { BrokerOrderService } from './saga/brokerOrders.js';
import { RabbitWorker, readiness, structuredLogger } from '@saga/shared/messaging';

const log = structuredLogger('order-orchestrator');
const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3000);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
const timeout = z.coerce.number().int().min(1000).max(3600000).parse(process.env.SAGA_COMMAND_TIMEOUT_MS ?? 30000);
const interval = z.coerce.number().int().min(100).max(60000).parse(process.env.RECOVERY_INTERVAL_MS ?? 1000);
const service = new BrokerOrderService(pool, 1000, timeout);
const recovery = new RecoveryWorker(service, interval, log);
const messaging = new RabbitWorker(pool, 'orders', envelope => service.receive(envelope), {
  url: process.env.RABBITMQ_URL ?? 'amqp://saga:saga@localhost:5672',
  prefix: process.env.RABBITMQ_PREFIX ?? 'saga.v1',
  log,
  onError: () => log({ event: 'messaging_error' }),
});
messaging.start();
recovery.start();
const server = serve({ fetch: createApp(service, () => readiness(pool, messaging, recovery)()).fetch, port }, info => {
  log({ event: 'http_started' });
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void recovery.stop().then(() => messaging.stop()).then(() => pool.end()); });
  });
}
server.on('error', (error: NodeJS.ErrnoException) => {
  log({ event: 'http_start_failed', reason: error.code ?? 'SERVER_ERROR' });
  void recovery.stop().then(() => messaging.stop()).then(() => pool.end()).finally(() => { process.exitCode = 1; });
});
