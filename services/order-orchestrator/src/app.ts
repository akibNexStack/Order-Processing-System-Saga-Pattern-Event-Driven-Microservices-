import type { Readiness } from '@saga/shared/messaging';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CreateOrderRequestSchema, IdSchema } from '@saga/shared';
import type { ServiceMetrics } from '@saga/shared';
import { OrderConflict, type OrderService } from './orders/service.js';

type Identity = { userId: string; role: 'CUSTOMER' | 'ADMIN' };

function identity(c: { req: { header(name: string): string | undefined } }): Identity | null {
  const userId = IdSchema.safeParse(c.req.header('x-saga-user-id'));
  const role = c.req.header('x-saga-role');
  if (!userId.success || (role !== 'CUSTOMER' && role !== 'ADMIN')) return null;
  return { userId: userId.data.toLowerCase(), role };
}

function forbidden(c: { json: (body: unknown, status: 401 | 403) => Response }, authenticated: boolean) {
  return c.json({ error: authenticated ? 'You do not have permission to access this order' : 'Authentication is required' }, authenticated ? 403 : 401);
}

export function createApp(service: OrderService, ready?: Readiness, requireIdentity = false, metrics?: ServiceMetrics) {

  // Create a new Hono application instance
  const app = new Hono();

  // Health check endpoints
  app.get('/ready', async c => {
    let checks;
    try { checks = await ready?.(); } catch {}
    const healthy = !!checks && Object.values(checks).every(Boolean);
    return c.json({ status: healthy ? 'ready' : 'not_ready', checks: checks ?? { configured: false } }, healthy ? 200 : 503);
  });

  // Basic health check endpoint
  app.get('/health', c => c.json({ service: 'order-orchestrator', status: 'ok' }));
  app.get('/metrics', c => metrics ? c.text(metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }) : c.text('# metrics not configured\n'));


  // Order-related endpoints

  // Limit the request body size to 32 KiB for order-related endpoints
  app.use('/orders', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: 'Request body exceeds 32 KiB' }, 413) }));

  // Endpoint to create a new order
  app.post('/orders', async c => {

    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);

    // Validate the Content-Type header to ensure it's application/json
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'Content-Type must be application/json' }, 415);

    // Attempt to parse the request body as JSON
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    // Validate the request body against the CreateOrderRequestSchema
    const parsed = CreateOrderRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid order', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);

    // Attempt to accept the order and handle the response accordingly
    // customerId from a browser is never trusted. The only owner is the
    // authenticated identity that the server-side proxy supplied.
    const accepted = await service.accept({ ...parsed.data, payload: { ...parsed.data.payload, customerId: actor?.userId ?? parsed.data.payload.customerId } });
    c.header('Location', `/orders/${accepted.orderId}`);
    await service.run(accepted.orderId);
    const state = await service.status(accepted.orderId);
    if (!state) throw new Error('Persisted order unavailable');
    if (state.saga.status === 'COMPLETED') return c.json(state, accepted.created ? 201 : 200);
    if (state.saga.status === 'FAILED') return c.json(state, 422);
    c.header('Retry-After', '1');
    return c.json(state, 202);
  });


  // Endpoint to retrieve orders that require attention
  app.get('/orders/attention', async c => {
    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);
    if (actor && actor.role !== 'ADMIN') return forbidden(c, true);
    return c.json({ orders: await service.attention(), limit: 100 });
  });

  // Endpoint to retrieve the history of a specific order
  app.get('/orders/:orderId/history', async c => {
    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const state = await service.status(id.data.toLowerCase());
    if (!state) return c.json({ error: 'Order not found' }, 404);
    if (actor && actor.role !== 'ADMIN' && state.order.customerId !== actor.userId) return forbidden(c, true);
    return c.json({ orderId: state.order.id, status: state.saga.status, interventionReason: state.saga.interventionReason,
      history: state.transitions.map(t => {
        const details = t.details as { event?: string; operation?: string; messageId?: string; reason?: string };
        return { sequence: t.sequence, at: t.createdAt, step: t.step, direction: t.direction,
          from: t.fromStatus, to: t.toStatus, event: details.event, operation: details.operation,
          messageId: details.messageId, reason: details.reason,
          summary: `${t.direction === 'COMPENSATION' ? 'Compensation' : 'Saga'}: ${(details.event ?? 'transition').toLowerCase().replaceAll('_', ' ')} (${t.step.toLowerCase()})` };
      }) });
  });

  // Endpoint to retrieve the status of a specific order
  app.get('/orders/:orderId', async c => {
    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const state = await service.status(id.data.toLowerCase());
    if (!state) return c.json({ error: 'Order not found' }, 404);
    if (actor && actor.role !== 'ADMIN' && state.order.customerId !== actor.userId) return forbidden(c, true);
    return c.json(state);
  });

  // Endpoint to confirm payment for a specific order
  app.post('/orders/:orderId/confirm-payment', async c => {
    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);
    if (actor && actor.role !== 'ADMIN') return forbidden(c, true);
    const id = IdSchema.safeParse(c.req.param('orderId'));
    if (!id.success) return c.json({ error: 'Invalid order ID' }, 400);
    const orderId = id.data.toLowerCase();
    if (!await service.status(orderId)) return c.json({ error: 'Order not found' }, 404);
    try { await service.confirmPayment(orderId); }
    catch { return c.json({ error: 'Payment confirmation is unavailable' }, 409); }
    const state = await service.status(orderId);
    c.header('Retry-After', '1');
    return c.json(state, 202);
  });

  // Endpoint to resume processing of a specific order
  app.post('/orders/:orderId/resume', async c => {
    const actor = identity(c);
    if (!actor && requireIdentity) return forbidden(c, false);
    if (actor && actor.role !== 'ADMIN') return forbidden(c, true);
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

  // Global error handler for the application
  app.onError((error, c) => {
    if (error instanceof OrderConflict) return c.json({ error: error.message }, 409);
    c.header('Retry-After', '1');
    return c.json({ error: 'Order service unavailable; retry with the original idempotency key' }, 503);
  });

  
  return app;
}
