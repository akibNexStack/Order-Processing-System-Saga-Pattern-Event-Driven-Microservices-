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
import { createApp } from './app.js';
import { createDatabase } from './db/client.js';
import { PaymentService } from './payments/service.js';
import { LocalPaymentProvider } from './providers/local-provider.js';

// Initialize the payment service with configuration from environment variables, set up database connection, messaging, and start the HTTP server to handle incoming requests.

const log = structuredLogger('payment-service');
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT ?? 3001);
const databaseUrl = z.string().min(1).parse(process.env.DATABASE_URL);
const mode = z
  .enum(['success', 'reject', 'timeout-after-success'])
  .parse(process.env.PAYMENT_SIMULATION_MODE ?? 'success');
const timeout = z.coerce
  .number()
  .int()
  .min(1)
  .max(60000)
  .parse(process.env.PAYMENT_PROVIDER_TIMEOUT_MS ?? 5000);
// Separate pools prevent provider calls from waiting on connections held by callers.
const { pool } = createDatabase(databaseUrl);
const { pool: providerPool } = createDatabase(databaseUrl);
const service = new PaymentService(pool, new LocalPaymentProvider(providerPool, mode), timeout);
const app = createApp(service, () => readiness(pool, messaging)());
const server = serve({ fetch: protectService(app.fetch), port }, (info) => {
  log({ event: 'http_started' });
});

// Set up a RabbitMQ worker to handle payment commands, using the participantHandler to process charge and refund commands through the PaymentService. The worker connects to RabbitMQ using configuration from environment variables and logs any messaging errors.
const messaging = new RabbitWorker(
  pool,
  'payment',
  participantHandler(pool, 'payment', (command, commit) =>
    service.execute(command as CommandFor<'CHARGE_PAYMENT' | 'REFUND_PAYMENT'>, commit),
  ),
  {
    url: process.env.RABBITMQ_URL ?? 'amqp://saga:saga@localhost:5672',
    prefix: process.env.RABBITMQ_PREFIX ?? 'saga.v1',
    log,
    onError: () => log({ event: 'messaging_error' }),
  },
);

// Start the messaging worker to listen for incoming payment commands and process them using the PaymentService. Set up signal handlers for graceful shutdown of the service, ensuring that the messaging worker and database connections are properly closed.
messaging.start();

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void messaging.stop().then(() => Promise.all([pool.end(), providerPool.end()]));
    });
  });
}

// Handle errors that occur during the startup of the HTTP server, logging the error and stopping the messaging worker and database connections before exiting the process with an error code.
server.on('error', (error: NodeJS.ErrnoException) => {
  log({ event: 'http_start_failed', reason: error.code ?? 'SERVER_ERROR' });
  void messaging
    .stop()
    .then(() => Promise.all([pool.end(), providerPool.end()]))
    .finally(() => {
      process.exitCode = 1;
    });
});
