import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceMetrics, instrumentHttp } from '../dist/index.js';

test('HTTP instrumentation adds a request ID, emits safe logs, and exposes bounded-label metrics', async () => {
  const logs = [];
  const metrics = new ServiceMetrics('test-service');
  const handler = instrumentHttp('test-service', metrics, entry => logs.push(entry), () => Response.json({ ok: true }));
  const response = await handler(new Request('http://test/orders/11111111-1111-4111-8111-111111111111'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(logs[0].event, 'http_request_completed');
  assert.equal(logs[0].route, '/orders/11111111-1111-4111-8111-111111111111');
  assert.match(metrics.render(), /route="\/orders\/:id"/);
});
