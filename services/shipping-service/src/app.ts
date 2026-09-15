import type { Readiness } from '@saga/shared/messaging';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CreateShipmentCommandSchema, CancelShipmentCommandSchema, IdSchema } from '@saga/shared';
import type { ServiceMetrics } from '@saga/shared';
import type { ShippingService } from './shipments/service.js';

// Create a Hono application for the shipping service, with endpoints for health checks, shipment operations (create and cancel), and retrieving shipment status for specific orders. The application includes request validation, error handling, and readiness checks.
export function createApp(service: ShippingService, ready?: Readiness, metrics?: ServiceMetrics) {
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
  app.get('/health', (c) => c.json({ service: 'shipping-service', status: 'ok' }));
  app.get('/metrics', c => metrics ? c.text(metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }) : c.text('# metrics not configured\n'));

  // Shipment-related endpoints
  app.use(
    '/shipments/*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: 'Request body exceeds 32 KiB' }, 413),
    }),
  );
  for (const operation of ['create', 'cancel'] as const) {
    app.post(`/shipments/${operation}`, async (c) => {
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
        return c.json({ error: 'Content-Type must be application/json' }, 415);
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      const parsed = (
        operation === 'create' ? CreateShipmentCommandSchema : CancelShipmentCommandSchema
      ).safeParse(body);
      if (!parsed.success)
        return c.json(
          {
            error: 'Invalid command',
            issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
          },
          400,
        );
      const result = await service.execute(parsed.data);
      if (result.outcome === 'UNKNOWN') {
        c.header('Retry-After', '1');
        return c.json(result, 202);
      }
      if (result.outcome === 'FAILED')
        return c.json(result, result.error.code === 'SHIPPING_REJECTED' ? 422 : 409);
      return c.json(result, 200);
    });
  }

  // Endpoint to retrieve the status of a shipment for a specific order
  app.get('/shipments/:orderId', async (c) => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const status = await service.status(id.data.toLowerCase());
    if (!status) return c.json({ error: 'Shipment not found' }, 404);
    // Internal service endpoint. Authentication belongs at the deployment boundary.
    return c.json(status);
  });

  // Error handling middleware to catch unhandled errors and return a 503 response with a retry suggestion
  app.onError((_error, c) => {
    c.header('Retry-After', '1');
    return c.json(
      { error: 'Shipment service unavailable; retry with the same idempotency key' },
      503,
    );
  });

  return app;
}
