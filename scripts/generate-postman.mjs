import { mkdirSync, writeFileSync } from 'node:fs';

// Source for the importable artifacts. Run from any directory with Node.
const directory = new URL('../postman/', import.meta.url);
const vars = {
  orders_url: 'http://localhost:3000', payment_url: 'http://localhost:3001',
  inventory_url: 'http://localhost:3002', shipping_url: 'http://localhost:3003',
  // Kept blank in committed artifacts. Set only in a Postman environment for
  // hosted services; local services intentionally accept an empty value.
  backend_api_token: '',
  customer_id: '33333333-3333-4333-8333-333333333333',
  keyboard_id: '44444444-4444-4444-8444-444444444444',
  mouse_id: '55555555-5555-4555-8555-555555555555',
  empty_product_id: '66666666-6666-4666-8666-666666666666',
  poll_max_attempts: '120', poll_delay_ms: '500', recovery_order_id: '',
};
const collection = {
  info: { name: 'Saga Order System — API and manual scenarios',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: 'Import and run folders 01–09 in order with both simulation modes set to success. Run optional folders 10+ individually after following their prerequisites. Start each workflow at its first request; it generates fresh IDs. Subsequent requests reuse those IDs. Polling loops only in Collection Runner/CLI/Newman; with Send, repeat the poll manually. See postman/README.md for setup, stock consumption, hosted authentication, and fault scenarios. Amounts are integer minor units; 12500 BDT means BDT 125.00. Providers are simulations. Hosted services require backend_api_token; local services accept an empty token.' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{backend_api_token}}', type: 'string' }] }, variable: [], item: [],
};
const script = (listen, code) => ({ listen, script: { type: 'text/javascript', exec: code.split('\n') } });
let count = 0;
const folder = (name, description) => { const f = { name, description, item: [] }; collection.item.push(f); return f; };
const check = (label, expression) => `pm.test(${JSON.stringify(label)}, function () { ${expression}; });`;
const equal = (path, value) => check(`${path} equals ${JSON.stringify(value)}`, `pm.expect(b.${path}).to.eql(${JSON.stringify(value)})`);
function add(f, name, service, path, { method = 'GET', body, status = 200, tests = '', pre = '', description = '', contentType = 'application/json' } = {}) {
  const request = { method, header: [{ key: 'Accept', value: 'application/json' }], url: `{{${service}_url}}${path}`, description };
  if (body !== undefined) {
    request.header.push({ key: 'Content-Type', value: contentType });
    request.body = { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
  }
  const event = [];
  if (pre) event.push(script('prerequest', pre));
  event.push(script('test', `${check(`HTTP ${[].concat(status).join(' or ')}`, `pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify([].concat(status))})`)}\nconst b = pm.response.json();\n${tests}`));
  f.item.push({ name: `${String(++count).padStart(3, '0')} · ${name}`, request, event, response: [] });
}
function init(prefix) {
  for (const suffix of ['order_id', 'saga_id', 'run_id']) vars[`${prefix}_${suffix}`] ??= '';
  return ['order_id', 'saga_id', 'run_id'].map(suffix => `pm.collectionVariables.set('${prefix}_${suffix}', pm.variables.replaceIn('{{$guid}}'));`).join('\n');
}
const address = { recipient: 'Postman Customer', line1: '10 Test Road', line2: 'Apartment 2', city: 'Dhaka', region: 'Dhaka', postalCode: '1207', countryCode: 'BD' };
const items = (product = 'keyboard_id', quantity = 1) => [{ productId: `{{${product}}}`, quantity }];
const order = (p, product) => ({ idempotencyKey: `postman:checkout:{{${p}_run_id}}`, payload: { customerId: '{{customer_id}}', items: items(product), amountMinor: 12500, currency: 'BDT', shippingAddress: structuredClone(address) } });
const commands = {
  charge: ['payment', '/payments/charge', 'CHARGE_PAYMENT', { customerId: '{{customer_id}}', amountMinor: 12500, currency: 'BDT' }, 'CHARGED'],
  refund: ['payment', '/payments/refund', 'REFUND_PAYMENT', {}, 'REFUNDED'],
  reserve: ['inventory', '/inventory/reserve', 'RESERVE_INVENTORY', { items: items() }, 'RESERVED'],
  release: ['inventory', '/inventory/release', 'RELEASE_INVENTORY', {}, 'RELEASED'],
  finalize: ['inventory', '/inventory/finalize', 'FINALIZE_INVENTORY', {}, 'FINALIZED'],
  create: ['shipping', '/shipments/create', 'CREATE_SHIPMENT', { items: items(), shippingAddress: address }, 'CREATED'],
  cancel: ['shipping', '/shipments/cancel', 'CANCEL_SHIPMENT', {}, 'CANCELLED'],
};
const command = (p, op) => ({ version: 1, orderId: `{{${p}_order_id}}`, sagaId: `{{${p}_saga_id}}`, idempotencyKey: `postman:${op}:{{${p}_run_id}}`, operation: commands[op][2], payload: structuredClone(commands[op][3]) });
function cmd(f, p, op, name, options = {}) {
  const { first, error, result = commands[op][4], ...rest } = options;
  add(f, name, commands[op][0], commands[op][1], { method: 'POST', body: command(p, op), pre: first ? init(p) : '',
    tests: equal('outcome', error ? 'FAILED' : 'SUCCEEDED') + '\n' + (error ? equal('error.code', error) : equal('data.status', result)) + '\n' +
      check('Response identifies the same command', `const sent = JSON.parse(pm.variables.replaceIn(pm.request.body.raw)); ['orderId','sagaId','operation','idempotencyKey'].forEach(k => pm.expect(b[k]).to.eql(sent[k]))`), ...rest });
}
const lookup = { payment: ['/payments/', 'payment'], inventory: ['/inventory/reservations/', 'reservation'], shipping: ['/shipments/', 'shipment'] };
function state(f, p, service, status) {
  add(f, `${service} persisted state: ${status}`, service, `${lookup[service][0]}{{${p}_order_id}}`, { tests: equal(`${lookup[service][1]}.status`, status) });
}
function poll(f, p, expected, extra = '') {
  add(f, `Poll until ${expected} (repeat Send manually)`, 'orders', `/orders/{{${p}_order_id}}`, { description: 'Runner repeats this request, at most poll_max_attempts times. Individual Send does not loop. A terminal mismatch, intervention flag, or timeout fails the test and stops the run.', tests: `
const n = Number(pm.collectionVariables.get('${p}_poll_count') || 0) + 1;
pm.collectionVariables.set('${p}_poll_count', String(n));
${check('Valid saga state', "pm.expect(b.saga.status).to.be.oneOf(['IN_PROGRESS','COMPENSATING','COMPLETED','FAILED'])")}
if (['COMPLETED', 'FAILED'].includes(b.saga.status)) {
  ${equal('saga.status', expected)}
  ${extra}
  pm.collectionVariables.set('${p}_poll_count', '0');
  if (b.saga.status !== '${expected}') pm.execution.setNextRequest(null);
} else if (b.requiresManualIntervention || n >= Number(pm.variables.get('poll_max_attempts'))) {
  ${check('Saga reached expected terminal state within polling budget', `pm.expect(b.saga.status).to.eql('${expected}')`)}
  pm.execution.setNextRequest(null);
} else {
  pm.execution.setNextRequest(pm.info.requestId);
  setTimeout(function () {}, Number(pm.variables.get('poll_delay_ms')));
}` });
}
function saga(f, p, expected, product, extra = '') {
  add(f, 'Create NEW order and save its ID', 'orders', '/orders', { method: 'POST', body: order(p, product), status: expected === 'COMPLETED' ? [201, 202] : [202, 422],
    pre: init(p) + `\npm.collectionVariables.set('${p}_poll_count', '0');`, tests: `
${check('Order ID returned', "pm.expect(b.order.id).to.be.a('string')")}
pm.collectionVariables.set('${p}_order_id', b.order.id);
${check('Location identifies order', "pm.expect(pm.response.headers.get('Location')).to.eql('/orders/' + b.order.id)")}`,
    description: 'Every Send of this first request creates a NEW checkout key. Use the replay request to test duplicate submission.' });
  poll(f, p, expected, extra);
  add(f, 'Read transition history', 'orders', `/orders/{{${p}_order_id}}/history`, { tests: equal('status', expected) + '\n' + check('History exists', 'pm.expect(b.history).to.be.an("array").that.is.not.empty') });
}

let f = folder('01 · Health and readiness', 'Start infrastructure, migrate, seed, and run all four services first. Both simulation modes must be success for folders 01–09.');
for (const service of ['orders', 'payment', 'inventory', 'shipping']) {
  add(f, `${service} health`, service, '/health', { tests: equal('status', 'ok') });
  add(f, `${service} readiness`, service, '/ready', { tests: equal('status', 'ready') + '\n' + check('All dependencies ready', 'pm.expect(Object.values(b.checks).every(Boolean)).to.eql(true)') });
}
f = folder('02 · Complete checkout and idempotency', 'One keyboard is permanently consumed per fresh successful run.');
saga(f, 'happy', 'COMPLETED', 'keyboard_id', equal('saga.inventoryFinalized', true) + '\n' + equal('saga.completedSteps', ['PAYMENT', 'INVENTORY', 'SHIPPING']));
for (const [service, status] of [['payment', 'CHARGED'], ['inventory', 'FINALIZED'], ['shipping', 'CREATED']]) state(f, 'happy', service, status);
add(f, 'Replay identical checkout — same order', 'orders', '/orders', { method: 'POST', body: order('happy'), tests: equal('saga.status', 'COMPLETED') + '\n' + check('Same order ID', "pm.expect(b.order.id).to.eql(pm.collectionVariables.get('happy_order_id'))") });
const changedOrder = order('happy'); changedOrder.payload.amountMinor = 13000;
add(f, 'Same checkout key, changed amount — conflict', 'orders', '/orders', { method: 'POST', body: changedOrder, status: 409 });
add(f, 'Resume completed order — remains completed', 'orders', '/orders/{{happy_order_id}}/resume', { method: 'POST', tests: equal('saga.status', 'COMPLETED') });
add(f, 'List orders requiring attention', 'orders', '/orders/attention', { tests: check('Attention list shape', 'pm.expect(b.orders).to.be.an("array"); pm.expect(b.limit).to.eql(100)') });

f = folder('03 · Inventory failure and payment compensation', 'The seeded monitor has zero stock. Checkout must fail only after refund finishes.');
saga(f, 'failed', 'FAILED', 'empty_product_id', equal('saga.compensatedSteps', ['PAYMENT']) + '\n' + equal('requiresCompensation', false));
state(f, 'failed', 'payment', 'REFUNDED');
state(f, 'failed', 'inventory', 'FAILED');
add(f, 'Shipping was never started', 'shipping', '/shipments/{{failed_order_id}}', { status: 404 });
add(f, 'Replay failed checkout', 'orders', '/orders', { method: 'POST', body: order('failed', 'empty_product_id'), status: 422, tests: equal('saga.status', 'FAILED') });
add(f, 'Resume failed order — remains failed', 'orders', '/orders/{{failed_order_id}}/resume', { method: 'POST', status: 422, tests: equal('saga.status', 'FAILED') });

for (const [number, p, service, forward, reverse, finalStatus] of [
  ['04', 'pay', 'payment', 'charge', 'refund', 'REFUNDED'],
  ['05', 'inv', 'inventory', 'reserve', 'release', 'RELEASED'],
  ['07', 'ship', 'shipping', 'create', 'cancel', 'CANCELLED'],
]) {
  f = folder(`${number} · Direct ${service} lifecycle`, 'Run top to bottom. Direct participant requests use separate IDs and do not create an orchestrator order. Replays return the historical command result; GET returns current persisted state.');
  cmd(f, p, forward, `NEW ${forward}`, { first: true });
  cmd(f, p, forward, `Replay ${forward}`);
  state(f, p, service, commands[forward][4]);
  const changed = command(p, forward);
  if (forward === 'charge') changed.payload.amountMinor++;
  else changed.payload.items[0].quantity++;
  cmd(f, p, forward, 'Changed payload with same key — conflict', { body: changed, status: 409, error: 'IDEMPOTENCY_CONFLICT' });
  cmd(f, p, reverse, reverse);
  cmd(f, p, reverse, `Replay ${reverse}`);
  state(f, p, service, finalStatus);
  cmd(f, p, forward, 'Original forward command still replays historical success');
  state(f, p, service, finalStatus);
  const freshKey = command(p, forward); freshKey.idempotencyKey += ':new';
  cmd(f, p, forward, 'New forward key after compensation — blocked', { body: freshKey, status: 409, error: 'ALREADY_COMPENSATED' });
  const tombstone = `${p}_noop`;
  cmd(f, tombstone, reverse, 'Compensate NEW unknown order — NOOP marker', { first: true, result: 'NOOP' });
  cmd(f, tombstone, forward, 'Late forward command after NOOP — blocked', { status: 409, error: 'ALREADY_COMPENSATED' });
}
f = folder('06 · Inventory finalization and stock failures', 'Finalization consumes one keyboard permanently. Reservation failures must not partially reserve a basket.');
cmd(f, 'final', 'reserve', 'NEW reservation for finalization', { first: true });
cmd(f, 'final', 'finalize', 'Finalize reservation');
cmd(f, 'final', 'finalize', 'Replay finalization');
state(f, 'final', 'inventory', 'FINALIZED');
cmd(f, 'final', 'release', 'Cannot release finalized inventory', { status: 409, error: 'INVALID_STATE' });
cmd(f, 'noreserve', 'finalize', 'Finalize without reservation', { first: true, status: 409, error: 'INVALID_STATE' });
const empty = command('empty', 'reserve'); empty.payload.items = items('empty_product_id');
cmd(f, 'empty', 'reserve', 'NEW out-of-stock reservation', { first: true, body: empty, status: 422, error: 'INSUFFICIENT_STOCK' });
cmd(f, 'empty', 'reserve', 'Replay stock failure', { body: empty, status: 422, error: 'INSUFFICIENT_STOCK' });
const basket = command('basket', 'reserve'); basket.payload.items = [...items(), ...items('empty_product_id')];
cmd(f, 'basket', 'reserve', 'Basket with available and unavailable products', { first: true, body: basket, status: 422, error: 'INSUFFICIENT_STOCK' });
state(f, 'basket', 'inventory', 'FAILED');
const missing = command('missing', 'reserve'); missing.payload.items = [{ productId: '{{missing_saga_id}}', quantity: 1 }];
cmd(f, 'missing', 'reserve', 'Unknown product fails reservation', { first: true, body: missing, status: 422, error: 'INSUFFICIENT_STOCK' });

f = folder('08 · Invalid IDs and missing resources', 'A fresh random UUID is used for missing resources.');
for (const [service, path] of [['orders', '/orders/'], ['orders', '/orders/ID/history'], ['payment', '/payments/'], ['inventory', '/inventory/reservations/'], ['shipping', '/shipments/'], ['orders', '/orders/ID/resume']]) {
  const method = path.endsWith('/resume') ? 'POST' : 'GET';
  for (const [id, status] of [['not-a-uuid', 400], ['{{absent_order_id}}', 404]]) {
    add(f, `${method} ${path} — ${status}`, service, path.includes('ID') ? path.replace('ID', id) : path + id, { method, status, pre: init('absent') });
  }
}
f = folder('09 · Request validation on every command endpoint', 'All cases here are rejected before business processing; no participant records should be created.');
const endpoints = [['orders', '/orders', order('invalid')], ...Object.keys(commands).map(op => [commands[op][0], commands[op][1], command('invalid', op)])];
for (const [service, path, body] of endpoints) {
  for (const [name, invalidBody, status, contentType, pre] of [
    ['empty object', {}, 400], ['malformed JSON', '{', 400], ['wrong content type', body, 415, 'text/plain'],
    ['body larger than 32 KiB', '{{oversized_body}}', 413, 'application/json', "pm.variables.set('oversized_body', JSON.stringify({padding:'x'.repeat(33000)}));"],
    ['unknown field', { ...body, unexpected: true }, 400],
  ]) add(f, `${path}: ${name}`, service, path, { method: 'POST', body: invalidBody, status, contentType, pre: init('invalid') + '\n' + (pre || '') });
}
for (const [name, mutate] of [
  ['zero amount', b => b.payload.amountMinor = 0], ['fractional amount', b => b.payload.amountMinor = 12.5],
  ['unsupported currency', b => b.payload.currency = 'EUR'], ['invalid customer ID', b => b.payload.customerId = 'customer-1'],
  ['missing recipient', b => delete b.payload.shippingAddress.recipient], ['lowercase country', b => b.payload.shippingAddress.countryCode = 'bd'],
  ['empty items', b => b.payload.items = []], ['duplicate products', b => b.payload.items.push({ ...b.payload.items[0] })],
  ['zero quantity', b => b.payload.items[0].quantity = 0], ['quantity above limit', b => b.payload.items[0].quantity = 10001],
  ['invalid idempotency key', b => b.idempotencyKey = 'contains spaces'],
]) {
  const b = order('invalid'); mutate(b);
  add(f, `Order: ${name}`, 'orders', '/orders', { method: 'POST', body: b, status: 400, pre: init('invalid'), tests: check('Validation issues returned', 'pm.expect(b.issues).to.be.an("array").that.is.not.empty') });
}
for (const op of Object.keys(commands)) {
  const b = command('invalid', op); b.operation = 'UNKNOWN_OPERATION';
  add(f, `${op}: wrong operation`, commands[op][0], commands[op][1], { method: 'POST', body: b, status: 400, pre: init('invalid') });
}

// Optional folders are deliberately skipped unless individually selected by name.
const optional = (name, description) => {
  const group = folder(name, description);
  group.event = [script('prerequest', `if (pm.variables.get('enabled_optional_folder') !== ${JSON.stringify(name.split(' · ')[0])}) pm.execution.skipRequest();`)];
  return group;
};
vars.enabled_optional_folder = 'none';
f = optional('10 · Payment rejection', 'Set PAYMENT_SIMULATION_MODE=reject; shipping mode success. Restart payment service. Set enabled_optional_folder=10 and run ONLY this folder. Restore success afterwards.');
saga(f, 'rejectpay', 'FAILED', 'keyboard_id', equal('saga.completedSteps', []));
state(f, 'rejectpay', 'payment', 'FAILED');
add(f, 'Inventory was never started', 'inventory', '/inventory/reservations/{{rejectpay_order_id}}', { status: 404 });

f = optional('11 · Shipping rejection and reverse compensation', 'Set SHIPPING_SIMULATION_MODE=reject; payment mode success. Restart shipping service. Set enabled_optional_folder=11 and run ONLY this folder. Restore success afterwards.');
saga(f, 'rejectship', 'FAILED', 'keyboard_id', equal('saga.compensatedSteps', ['INVENTORY', 'PAYMENT']));
state(f, 'rejectship', 'payment', 'REFUNDED'); state(f, 'rejectship', 'inventory', 'RELEASED'); state(f, 'rejectship', 'shipping', 'FAILED');

for (const [number, service, forward, reverse] of [['12', 'payment', 'charge', 'refund'], ['13', 'shipping', 'create', 'cancel']]) {
  f = optional(`${number} · ${service} ambiguous timeout reconciliation`, `Set ${service.toUpperCase()}_SIMULATION_MODE=timeout-after-success and restart that service. Set enabled_optional_folder=${number}; run ONLY this folder. The first request applies the simulated effect but returns UNKNOWN. Retry the identical command to reconcile. Restore success afterwards.`);
  const p = `timeout_${service}`;
  for (const op of [forward, reverse]) {
    cmd(f, p, op, `First ${op}: provider effect with lost response`, { first: op === forward, status: 202,
      tests: equal('outcome', 'UNKNOWN') + '\n' + equal('error.retryable', true) + '\n' + check('Retry hint', "pm.expect(pm.response.headers.get('Retry-After')).to.eql('1')") });
    cmd(f, p, op, `Retry identical ${op}: reconcile`);
  }
  state(f, p, service, commands[reverse][4]);
}
f = optional('14 · Manual recovery tools — use Send individually', 'Set enabled_optional_folder=14. Set recovery_order_id to an existing order. Follow README fault instructions. Do NOT run this folder as an automatic failure test: it contains diagnostic tools for states you establish manually.');
add(f, 'List flagged orders', 'orders', '/orders/attention', { tests: check('Attention list', 'pm.expect(b.orders).to.be.an("array")') });
add(f, 'Inspect selected order', 'orders', '/orders/{{recovery_order_id}}', { tests: check('Saga present', 'pm.expect(b.saga).to.be.an("object")') });
add(f, 'Inspect selected order history', 'orders', '/orders/{{recovery_order_id}}/history', { tests: check('History present', 'pm.expect(b.history).to.be.an("array")') });
add(f, 'Resume selected order after dependency recovery', 'orders', '/orders/{{recovery_order_id}}/resume', { method: 'POST', status: [200, 202, 422], description: '200 completed; 202 still processing; 422 terminal business failure after compensation. Inspect state and history; HTTP acceptance alone does not prove recovery.' });
add(f, 'Broker outage: orchestrator still alive', 'orders', '/health', { tests: equal('status', 'ok') });
add(f, 'Broker outage: readiness reports dependency failure', 'orders', '/ready', { status: 503, tests: equal('status', 'not_ready') + '\n' + equal('checks.broker', false), description: 'Send only while RabbitMQ is stopped. A stopped HTTP process instead causes a connection error, not HTTP 503.' });

collection.item.sort((a, b) => a.name.localeCompare(b.name));
let sequence = 0;
for (const group of collection.item) for (const item of group.item) {
  item.name = item.name.replace(/^\d+/, String(++sequence).padStart(3, '0'));
}
collection.variable = Object.entries(vars).map(([key, value]) => ({ key, value, type: 'string' }));
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('Saga-System.postman_collection.json', directory), JSON.stringify(collection, null, 2) + '\n');
writeFileSync(new URL('Local.postman_environment.json', directory), JSON.stringify({
  name: 'Saga System — Local', _postman_variable_scope: 'environment',
  values: Object.entries(vars).filter(([key]) => key.endsWith('_url') || ['customer_id', 'keyboard_id', 'mouse_id', 'empty_product_id', 'poll_max_attempts', 'poll_delay_ms', 'enabled_optional_folder', 'recovery_order_id'].includes(key))
    .map(([key, value]) => ({ key, value, enabled: true, type: 'default' })),
}, null, 2) + '\n');
const renderVars = {
  ...vars,
  orders_url: 'https://saga-orders.onrender.com',
  payment_url: 'https://saga-payment.onrender.com',
  inventory_url: 'https://saga-inventory.onrender.com',
  shipping_url: 'https://saga-shipping.onrender.com',
  backend_api_token: '',
};
writeFileSync(new URL('Render.postman_environment.json', directory), JSON.stringify({
  name: 'Saga System — Render', _postman_variable_scope: 'environment',
  values: Object.entries(renderVars)
    .filter(([key]) => key.endsWith('_url') || key === 'backend_api_token' || ['customer_id', 'keyboard_id', 'mouse_id', 'empty_product_id', 'poll_max_attempts', 'poll_delay_ms', 'enabled_optional_folder', 'recovery_order_id'].includes(key))
    .map(([key, value]) => ({ key, value, enabled: true, type: key === 'backend_api_token' ? 'secret' : 'default' })),
}, null, 2) + '\n');
console.log(`Generated ${count} requests in ${collection.item.length} folders.`);
