import type { Readiness } from '@saga/shared/messaging';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  ReserveInventoryCommandSchema,
  ReleaseInventoryCommandSchema,
  FinalizeInventoryCommandSchema,
  IdSchema,
} from '@saga/shared';
import type { InventoryService } from './inventory/service.js';

// Create a Hono application for the inventory service, with endpoints for health checks, inventory operations (reserve, release, finalize), and retrieving reservation status for specific orders. The application includes request validation, error handling, and readiness checks.
export function createApp(service: InventoryService, ready?: Readiness) {
  const app = new Hono();

  // Health check endpoints
  app.get('/ready', async (c) => {
    let checks;
    try {
      checks = await ready?.();
    } catch {}
    const healthy = !!checks && Object.values(checks).every(Boolean);
    return c.json(
      { status: healthy ? 'ready' : 'not_ready', checks: checks ?? { configured: false } },
      healthy ? 200 : 503,
    );
  });

  // Basic health check endpoint
  app.get('/health', (c) => c.json({ service: 'inventory-service', status: 'ok' }));

  // Availability is a current snapshot; reserve performs the final locked
  // stock check when an order is submitted.
  app.get('/products', async (c) => c.json({ products: await service.listProducts() }));
  app.get('/products/:productId', async (c) => {
    const id = IdSchema.safeParse(c.req.param('productId'));
    if (!id.success) return c.json({ error: 'Invalid product ID' }, 400);
    const product = await service.getProduct(id.data.toLowerCase());
    return product ? c.json({ product }) : c.json({ error: 'Product not found' }, 404);
  });

  // Inventory-related endpoints
  app.use(
    '/inventory/*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: 'Request body exceeds 32 KiB' }, 413),
    }),
  );
  for (const [path, schema] of [
    ['reserve', ReserveInventoryCommandSchema],
    ['release', ReleaseInventoryCommandSchema],
    ['finalize', FinalizeInventoryCommandSchema],
  ] as const) {
    app.post(`/inventory/${path}`, async (c) => {
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? ''))
        return c.json({ error: 'Content-Type must be application/json' }, 415);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success)
        return c.json(
          {
            error: 'Invalid command',
            issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
          },
          400,
        );
      const result = await service.execute(parsed.data);
      if (result.outcome === 'FAILED')
        return c.json(result, result.error.code === 'INSUFFICIENT_STOCK' ? 422 : 409);
      return c.json(result, 200);
    });
  }

  // Endpoint to retrieve the status of an inventory reservation for a specific order
  app.get('/inventory/reservations/:orderId', async (c) => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const status = await service.status(id.data.toLowerCase());
    return status ? c.json(status) : c.json({ error: 'Reservation not found' }, 404);
  });

  // Error handling middleware to catch unhandled errors and return a 503 response with a retry suggestion
  app.onError((_error, c) => {
    c.header('Retry-After', '1');
    return c.json(
      { error: 'Inventory service unavailable; retry with the same idempotency key' },
      503,
    );
  });

  return app;
}
