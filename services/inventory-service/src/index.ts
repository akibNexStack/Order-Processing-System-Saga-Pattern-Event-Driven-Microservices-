import {
  RabbitWorker,
  participantHandler,
  readiness,
  structuredLogger,
} from '@saga/shared/messaging';
import type { CommandFor } from '@saga/shared';
import 'dotenv/config';
import { protectService } from '@saga/shared/http';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createDatabase } from './db/client.js';
import { createApp } from './app.js';
import { InventoryService } from './inventory/service.js';

// Initialize the inventory service with configuration from environment variables, set up database connection, messaging, and start the HTTP server to handle incoming requests.

const log = structuredLogger('inventory-service');
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT ?? 3002);
const { pool } = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));

// Create an instance of the InventoryService and set up the Hono application with readiness checks. Start the HTTP server to handle incoming requests for inventory operations.
const service = new InventoryService(pool);
const server = serve(
  { fetch: protectService(createApp(service, () => readiness(pool, messaging)()).fetch), port },
  (info) => {
    log({ event: 'http_started' });
  },
);

// Set up a RabbitMQ worker to handle inventory commands, using the participantHandler to process reserve, release, and finalize inventory commands through the InventoryService. The worker connects to RabbitMQ using configuration from environment variables and logs any messaging errors.
const messaging = new RabbitWorker(
  pool,
  'inventory',
  participantHandler(pool, 'inventory', (command, commit) =>
    service.execute(
      command as CommandFor<'RESERVE_INVENTORY' | 'RELEASE_INVENTORY' | 'FINALIZE_INVENTORY'>,
      commit,
    ),
  ),
  {
    url: process.env.RABBITMQ_URL ?? 'amqp://saga:saga@localhost:5672',
    prefix: process.env.RABBITMQ_PREFIX ?? 'saga.v1',
    log,
    onError: () => log({ event: 'messaging_error' }),
  },
);

messaging.start();

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void messaging.stop().then(() => pool.end());
    });
  });
}

// Handle errors that occur during the startup of the HTTP server, logging the error and stopping the messaging worker and database connections before exiting the process with an error code.
server.on('error', (error: NodeJS.ErrnoException) => {
  log({ event: 'http_start_failed', reason: error.code ?? 'SERVER_ERROR' });
  void messaging
    .stop()
    .then(() => pool.end())
    .finally(() => {
      process.exitCode = 1;
    });
});
