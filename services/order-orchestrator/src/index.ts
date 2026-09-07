import 'dotenv/config';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { BrokerOrderService } from './saga/brokerOrders.js';
import { RabbitWorker } from '@saga/shared/messaging';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3000);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
const service = new BrokerOrderService(pool);
const messaging = new RabbitWorker(pool, 'orders', envelope => service.receive(envelope), {
  url: process.env.RABBITMQ_URL ?? 'amqp://saga:saga@localhost:5672',
  prefix: process.env.RABBITMQ_PREFIX ?? 'saga.v1',
  onError: () => console.error('orders messaging temporarily unavailable or message rejected; pending work retained'),
});
messaging.start();
const server = serve({ fetch: createApp(service).fetch, port }, info => {
  console.log(`order-orchestrator listening on port ${info.port}`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void messaging.stop().then(() => pool.end()); });
  });
}
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`order-orchestrator could not start: ${error.code ?? 'server error'}`);
  void messaging.stop().then(() => pool.end()).finally(() => { process.exitCode = 1; });
});
