import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CommandSchema, ResultSchema, OrderPayloadSchema, CreateOrderRequestSchema,
  SagaStatusSchema, SagaStepSchema, commandKey, commandFingerprint,
} from '../dist/index.js';
import { SimulatedPaymentProvider, SimulatedShippingProvider } from '../dist/testing/providers.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const sagaId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const items = [{ productId: '44444444-4444-4444-8444-444444444444', quantity: 2 }];
const shippingAddress = { recipient: 'Test Customer', line1: '10 Test Road', city: 'Dhaka', postalCode: '1207', countryCode: 'BD' };
const payload = { customerId, items, amountMinor: 12500, currency: 'BDT', shippingAddress };
const payloads = {
  CHARGE_PAYMENT: { customerId, amountMinor: 12500, currency: 'BDT' },
  REFUND_PAYMENT: {}, RESERVE_INVENTORY: { items }, RELEASE_INVENTORY: {},
  CREATE_SHIPMENT: { items, shippingAddress }, CANCEL_SHIPMENT: {},
};
const command = (operation) => ({ version: 1, sagaId, orderId, operation, idempotencyKey: commandKey(sagaId, operation), payload: structuredClone(payloads[operation]) });

test('order survives JSON transport with a validated, normalized address', () => {
  const request = { idempotencyKey: 'checkout:1', payload };
  assert.deepEqual(CreateOrderRequestSchema.parse(JSON.parse(JSON.stringify(request))), request);
  assert.equal(OrderPayloadSchema.parse({ ...payload, shippingAddress: { ...shippingAddress, city: ' Dhaka ' } }).shippingAddress.city, 'Dhaka');
});

for (const [label, patch] of [
  ['fractional money', { amountMinor: 12.5 }], ['zero money', { amountMinor: 0 }],
  ['oversized money', { amountMinor: 10_000_000_000 }], ['string money', { amountMinor: '12500' }],
  ['unsupported currency', { currency: 'XYZ' }], ['invalid customer', { customerId: 'bad' }],
  ['empty basket', { items: [] }], ['duplicate products', { items: [...items, ...items] }],
  ['fractional quantity', { items: [{ ...items[0], quantity: 0.5 }] }],
  ['negative quantity', { items: [{ ...items[0], quantity: -1 }] }],
  ['blank address', { shippingAddress: { ...shippingAddress, line1: ' ' } }],
  ['simulation controls in public payload', { forceFailure: true }],
]) test(`rejects ${label}`, () => assert.equal(OrderPayloadSchema.safeParse({ ...payload, ...patch }).success, false));

test('all six command contracts validate, with distinct stable operation keys', () => {
  const commands = Object.keys(payloads).map(command);
  for (const c of commands) assert.deepEqual(CommandSchema.parse(c), c);
  assert.equal(new Set(commands.map(c => c.idempotencyKey)).size, 6);
  assert.equal(commandKey(sagaId, 'CHARGE_PAYMENT'), commandKey(sagaId, 'CHARGE_PAYMENT'));
  assert.equal(CommandSchema.safeParse({ ...command('CHARGE_PAYMENT'), payload: {} }).success, false);
  assert.equal(CommandSchema.safeParse({ ...command('REFUND_PAYMENT'), version: 2 }).success, false);
  for (const idempotencyKey of ['', 'contains spaces', 'x'.repeat(256)]) {
    assert.equal(CommandSchema.safeParse({ ...command('REFUND_PAYMENT'), idempotencyKey }).success, false);
  }
});

test('fingerprints ignore object key order and keys but detect changed business input', () => {
  const c = command('CHARGE_PAYMENT');
  assert.equal(commandFingerprint(c), commandFingerprint({ ...c, idempotencyKey: 'another', payload: { currency: 'BDT', amountMinor: 12500, customerId } }));
  assert.notEqual(commandFingerprint(c), commandFingerprint({ ...c, payload: { ...c.payload, amountMinor: 12501 } }));
});

test('results require operation-specific success data and distinguish uncertain outcomes', () => {
  const { payload: _, ...metadata } = command('RESERVE_INVENTORY');
  assert.ok(ResultSchema.safeParse({ ...metadata, outcome: 'SUCCEEDED', data: { status: 'RESERVED', reservationId: orderId } }).success);
  assert.equal(ResultSchema.safeParse({ ...metadata, outcome: 'SUCCEEDED', data: { status: 'CHARGED', providerTransactionId: 'sim_1' } }).success, false);
  assert.equal(ResultSchema.safeParse({ ...metadata, outcome: 'FAILED', error: { code: 'PROVIDER_TIMEOUT', message: 'timeout', retryable: false } }).success, false);
  assert.ok(ResultSchema.safeParse({ ...metadata, outcome: 'UNKNOWN', error: { code: 'PROVIDER_TIMEOUT', message: 'timeout', retryable: true } }).success);
  for (const status of ['IN_PROGRESS', 'COMPENSATING', 'COMPLETED', 'FAILED']) assert.ok(SagaStatusSchema.safeParse(status).success);
  for (const step of ['PAYMENT', 'INVENTORY', 'SHIPPING']) assert.ok(SagaStepSchema.safeParse(step).success);
  assert.equal(SagaStatusSchema.safeParse('CANCELLED').success, false);
});

for (const [label, Provider, forward, reverse, run, undo, reversed] of [
  ['payment', SimulatedPaymentProvider, 'CHARGE_PAYMENT', 'REFUND_PAYMENT', 'charge', 'refund', 'REFUNDED'],
  ['shipping', SimulatedShippingProvider, 'CREATE_SHIPMENT', 'CANCEL_SHIPMENT', 'create', 'cancel', 'CANCELLED'],
]) {
  test(`${label}: concurrent retries return one result and compensation is repeatable`, async () => {
    const provider = new Provider();
    const c = command(forward);
    const results = await Promise.all(Array.from({ length: 20 }, () => provider[run](c)));
    assert.equal(results[0].outcome, 'SUCCEEDED');
    for (const result of results) assert.deepEqual(result, results[0]);
    results[0].data.status = 'tampered';
    assert.notEqual((await provider[run](c)).data.status, 'tampered');
    const compensation = await provider[undo](command(reverse));
    assert.equal(compensation.data.status, reversed);
    assert.deepEqual(await provider[undo](command(reverse)), compensation);
    assert.equal((await provider[undo]({ ...command(reverse), idempotencyKey: 'other-undo' })).data.status, 'NOOP');
    assert.equal((await provider[run]({ ...c, idempotencyKey: 'late-forward' })).error.code, 'ALREADY_COMPENSATED');
  });
  test(`${label}: mismatched reuse is rejected`, async () => {
    const provider = new Provider();
    const c = command(forward);
    await provider[run](c);
    const changed = structuredClone(c);
    if (label === 'payment') changed.payload.amountMinor++;
    else changed.payload.items[0].quantity++;
    assert.equal((await provider[run](changed)).error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await provider[run]({ ...changed, idempotencyKey: 'different-key' })).error.code, 'IDEMPOTENCY_CONFLICT');
  });
  test(`${label}: compensation before forward is a safe no-op and blocks delayed work`, async () => {
    const provider = new Provider();
    assert.equal((await provider[undo](command(reverse))).data.status, 'NOOP');
    assert.equal((await provider[run](command(forward))).error.code, 'ALREADY_COMPENSATED');
  });
  test(`${label}: rejected actions have nothing to compensate`, async () => {
    const provider = new Provider('reject');
    const first = await provider[run](command(forward));
    assert.equal(first.outcome, 'FAILED');
    assert.deepEqual(await provider[run](command(forward)), first);
    assert.equal((await provider[undo](command(reverse))).data.status, 'NOOP');
  });
  test(`${label}: timeout after success resolves on retry with the same key`, async () => {
    const provider = new Provider('timeout-after-success');
    assert.equal((await provider[run](command(forward))).outcome, 'UNKNOWN');
    assert.equal((await provider[run](command(forward))).outcome, 'SUCCEEDED');
    assert.equal((await provider[undo](command(reverse))).data.status, reversed);
  });
}
