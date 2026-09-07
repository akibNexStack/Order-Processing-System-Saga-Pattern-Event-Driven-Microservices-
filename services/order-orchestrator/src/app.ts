import type { Readiness } from '@saga/shared/messaging';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CreateOrderRequestSchema, IdSchema } from '@saga/shared';
import { OrderConflict, type OrderService } from './orders/service.js';

export function createApp(service: OrderService, ready?: Readiness) {
  const app = new Hono();
  app.get('/ready', async c => {
    let checks;
    try { checks = await ready?.(); } catch {}
    const healthy = !!checks && Object.values(checks).every(Boolean);
    return c.json({ status: healthy ? 'ready' : 'not_ready', checks: checks ?? { configured: false } }, healthy ? 200 : 503);
  });
  app.get('/health', c => c.json({ service: 'order-orchestrator', status: 'ok' }));
  app.use('/orders', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: 'Request body exceeds 32 KiB' }, 413) }));
  app.post('/orders', async c => {
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'Content-Type must be application/json' }, 415);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
    const parsed = CreateOrderRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid order', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
    const accepted = await service.accept(parsed.data);
    c.header('Location', `/orders/${accepted.orderId}`);
    await service.run(accepted.orderId);
    const state = await service.status(accepted.orderId);
    if (!state) throw new Error('Persisted order unavailable');
    if (state.saga.status === 'COMPLETED') return c.json(state, accepted.created ? 201 : 200);
    if (state.saga.status === 'FAILED') return c.json(state, 422);
    c.header('Retry-After', '1');
    return c.json(state, 202);
  });
  app.get('/orders/attention', async c => c.json({ orders: await service.attention(), limit: 100 }));
  app.get('/orders/:orderId/history', async c => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const state = await service.status(id.data.toLowerCase());
    if (!state) return c.json({ error: 'Order not found' }, 404);
    return c.json({ orderId: state.order.id, status: state.saga.status, interventionReason: state.saga.interventionReason,
      history: state.transitions.map(t => {
        const details = t.details as { event?: string; operation?: string; messageId?: string; reason?: string };
        return { sequence: t.sequence, at: t.createdAt, step: t.step, direction: t.direction,
          from: t.fromStatus, to: t.toStatus, event: details.event, operation: details.operation,
          messageId: details.messageId, reason: details.reason,
          summary: `${t.direction === 'COMPENSATION' ? 'Compensation' : 'Saga'}: ${(details.event ?? 'transition').toLowerCase().replaceAll('_', ' ')} (${t.step.toLowerCase()})` };
      }) });
  });
  app.get('/orders/:orderId', async c => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const state = await service.status(id.data.toLowerCase());
    return state ? c.json(state) : c.json({ error: 'Order not found' }, 404);
  });
  app.post('/orders/:orderId/resume', async c => {
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const orderId = id.data.toLowerCase();
    if (!await service.status(orderId)) return c.json({ error: 'Order not found' }, 404);
    await service.run(orderId);
    const state = await service.status(orderId);
    if (state?.saga.status === 'COMPLETED') return c.json(state, 200);
    if (state?.saga.status === 'FAILED') return c.json(state, 422);
    c.header('Retry-After', '1');
    return c.json(state, 202);
  });
  app.onError((error, c) => {
    if (error instanceof OrderConflict) return c.json({ error: error.message }, 409);
    c.header('Retry-After', '1');
    return c.json({ error: 'Order service unavailable; retry with the original idempotency key' }, 503);
  });
  return app;
}
