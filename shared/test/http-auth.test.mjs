import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectService } from '../dist/http/auth.js';

test('hosted service auth fails closed and protects business reads, writes, and readiness', async () => {
  assert.throws(() => protectService(() => new Response(), { REQUIRE_SERVICE_AUTH: '1' }));
  assert.throws(() => protectService(() => new Response(), { RENDER: 'true' }));
  assert.throws(() => protectService(() => new Response(), { BACKEND_API_TOKEN: 'short' }));
  const token = 'a'.repeat(48);
  let calls = 0;
  const handler = protectService(() => { calls++; return Response.json({ ok: true }); }, { BACKEND_API_TOKEN: token });
  for (const path of ['/orders', '/orders/attention', '/payments/charge', '/ready']) {
    for (const method of ['GET', 'POST']) {
      assert.equal((await handler(new Request('http://test' + path, { method }))).status, 401);
      assert.equal((await handler(new Request('http://test' + path, { method, headers: { authorization: 'Bearer wrong' } }))).status, 401);
    }
  }
  assert.equal(calls, 0);
  assert.equal((await handler(new Request('http://test/health'))).status, 200);
  assert.equal((await handler(new Request('http://test/orders', { headers: { authorization: 'Bearer ' + token } }))).status, 200);
  assert.equal(calls, 2);
  assert.equal((await protectService(() => new Response(), {})(new Request('http://local/orders'))).status, 200);
});
