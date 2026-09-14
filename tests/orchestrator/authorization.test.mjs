import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../../services/order-orchestrator/dist/app.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const sagaId = '44444444-4444-4444-8444-444444444444';
const state = {
  order: { id: orderId, customerId: owner },
  saga: { id: sagaId, status: 'PENDING_PAYMENT', interventionReason: null },
  transitions: [], items: [], requiresCompensation: false, requiresManualIntervention: false,
};
const headers = (userId, role) => ({ 'x-saga-user-id': userId, 'x-saga-role': role });

test('order routes enforce session identity, ownership, and administrator operations', async () => {
  let confirmed = 0;
  let resumed = 0;
  const app = createApp({
    accept: async () => ({ orderId, created: true }),
    run: async () => { resumed++; },
    status: async () => state,
    attention: async () => [{ orderId, sagaId, status: 'PENDING_PAYMENT', operation: 'CHARGE_PAYMENT', reason: 'CHECK', updatedAt: new Date() }],
    confirmPayment: async () => { confirmed++; },
  }, undefined, true);

  assert.equal((await app.request(`/orders/${orderId}`)).status, 401);
  assert.equal((await app.request(`/orders/${orderId}`, { headers: headers(other, 'CUSTOMER') })).status, 403);
  assert.equal((await app.request(`/orders/${orderId}`, { headers: headers(owner, 'CUSTOMER') })).status, 200);
  assert.equal((await app.request(`/orders/${orderId}`, { headers: headers(other, 'ADMIN') })).status, 200);
  assert.equal((await app.request('/orders/attention', { headers: headers(owner, 'CUSTOMER') })).status, 403);
  assert.equal((await app.request('/orders/attention', { headers: headers(other, 'ADMIN') })).status, 200);
  assert.equal((await app.request(`/orders/${orderId}/resume`, { method: 'POST', headers: headers(owner, 'CUSTOMER') })).status, 403);
  assert.equal((await app.request(`/orders/${orderId}/resume`, { method: 'POST', headers: headers(other, 'ADMIN') })).status, 202);
  assert.equal(resumed, 1);
  assert.equal((await app.request(`/orders/${orderId}/confirm-payment`, { method: 'POST', headers: headers(owner, 'CUSTOMER') })).status, 403);
  assert.equal((await app.request(`/orders/${orderId}/confirm-payment`, { method: 'POST', headers: headers(other, 'ADMIN') })).status, 202);
  assert.equal(confirmed, 1);
});
