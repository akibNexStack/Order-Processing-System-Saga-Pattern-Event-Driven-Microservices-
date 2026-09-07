import type { Readiness } from '@saga/shared/messaging';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ChargePaymentCommandSchema, RefundPaymentCommandSchema, IdSchema } from '@saga/shared';
import type { PaymentService } from './payments/service.js';

export function createApp(service: PaymentService, ready?: Readiness) {
  const app = new Hono();
  app.get('/ready', async c => {
    let checks;
    try { checks = await ready?.(); } catch {}
    const healthy = !!checks && Object.values(checks).every(Boolean);
    return c.json({ status: healthy ? 'ready' : 'not_ready', checks: checks ?? { configured: false } }, healthy ? 200 : 503);
  });
  app.get('/health', (c) => c.json({ service: 'payment-service', status: 'ok' }));
  app.use('/payments/*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: 'Request body exceeds 32 KiB' }, 413) }));
  for (const operation of ['charge', 'refund'] as const) {
    app.post(`/payments/${operation}`, async (c) => {
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
        return c.json({ error: 'Content-Type must be application/json' }, 415);
      }
      let body: unknown;
      try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
      const parsed = (operation === 'charge' ? ChargePaymentCommandSchema : RefundPaymentCommandSchema).safeParse(body);
      if (!parsed.success) return c.json({ error: 'Invalid command', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
      const result = await service.execute(parsed.data);
      if (result.outcome === 'UNKNOWN') {
        c.header('Retry-After', '1');
        return c.json(result, 202);
      }
      if (result.outcome === 'FAILED') return c.json(result, result.error.code === 'PAYMENT_DECLINED' ? 422 : 409);
      return c.json(result, 200);
    });
  }
  app.get('/payments/:orderId', async (c) => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const status = await service.status(id.data.toLowerCase());
    if (!status) return c.json({ error: 'Payment not found' }, 404);
    // Internal service endpoint. Authentication belongs at the deployment boundary.
    return c.json(status);
  });
  app.onError((_error, c) => {
    c.header('Retry-After', '1');
    return c.json({ error: 'Payment service unavailable; retry with the same idempotency key' }, 503);
  });
  return app;
}
