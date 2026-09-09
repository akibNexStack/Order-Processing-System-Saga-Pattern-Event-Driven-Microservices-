// Run migrations before starting the service, without shell command parsing.
const service = process.argv[2];
if (!['payment-service', 'inventory-service', 'shipping-service', 'order-orchestrator'].includes(service))
  throw new Error('Unknown service');

await import('./migrate-service.mjs');
await import('./render-start.mjs');
