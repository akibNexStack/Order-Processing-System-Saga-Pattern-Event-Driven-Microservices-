const service = process.argv[2];
if (!['payment-service', 'inventory-service', 'shipping-service', 'order-orchestrator'].includes(service))
  throw new Error('Unknown service');
if (!process.env.RABBITMQ_URL) {
  const { RABBITMQ_HOST, RABBITMQ_USER, RABBITMQ_PASSWORD } = process.env;
  if (!RABBITMQ_HOST || !RABBITMQ_USER || !RABBITMQ_PASSWORD) throw new Error('RabbitMQ configuration is required');
  const url = new URL(`amqp://${RABBITMQ_HOST}:5672`);
  url.username = RABBITMQ_USER;
  url.password = RABBITMQ_PASSWORD;
  process.env.RABBITMQ_URL = url.href;
}
await import(`../services/${service}/dist/index.js`);
