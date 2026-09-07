import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PORT ?? 3001);
const app = new Hono();

// Liveness only; database and broker connectivity are not checked yet.
app.get('/health', (c) => c.json({ service: 'payment-service', status: 'ok' }));

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log('payment-service listening on port ' + info.port);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
