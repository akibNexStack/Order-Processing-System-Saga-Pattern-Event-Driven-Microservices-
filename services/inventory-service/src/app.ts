import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ReserveInventoryCommandSchema, ReleaseInventoryCommandSchema, FinalizeInventoryCommandSchema, IdSchema } from '@saga/shared';
import type { InventoryService } from './inventory/service.js';

export function createApp(service: InventoryService) {
  const app = new Hono();
  app.get('/health', c => c.json({ service: 'inventory-service', status: 'ok' }));
  app.use('/inventory/*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: 'Request body exceeds 32 KiB' }, 413) }));
  for (const [path, schema] of [['reserve', ReserveInventoryCommandSchema], ['release', ReleaseInventoryCommandSchema], ['finalize', FinalizeInventoryCommandSchema]] as const) {
    app.post(`/inventory/${path}`, async c => {
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'Content-Type must be application/json' }, 415);
      let body: unknown;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Invalid command', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
      const result = await service.execute(parsed.data);
      if (result.outcome === 'FAILED') return c.json(result, result.error.code === 'INSUFFICIENT_STOCK' ? 422 : 409);
      return c.json(result, 200);
    });
  }
  app.get('/inventory/reservations/:orderId', async c => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const status = await service.status(id.data.toLowerCase());
    return status ? c.json(status) : c.json({ error: 'Reservation not found' }, 404);
  });
  app.onError((_error, c) => {
    c.header('Retry-After', '1');
    return c.json({ error: 'Inventory service unavailable; retry with the same idempotency key' }, 503);
  });
  return app;
}
