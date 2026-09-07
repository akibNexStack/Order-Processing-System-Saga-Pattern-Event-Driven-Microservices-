// Test-only process runner. Production services have no fault-injection endpoints.
import pg from 'pg';
import { serve } from '@hono/node-server';
import { RabbitWorker, participantHandler, readiness } from '@saga/shared/messaging';
import { InventoryService } from '../../services/inventory-service/dist/inventory/service.js';
import { createApp as inventoryApp } from '../../services/inventory-service/dist/app.js';
import { BrokerOrderService } from '../../services/order-orchestrator/dist/saga/brokerOrders.js';
import { RecoveryWorker } from '../../services/order-orchestrator/dist/saga/recoveryWorker.js';
import { createApp as orderApp } from '../../services/order-orchestrator/dist/app.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
const name = process.env.SYSTEM_SERVICE;
const point = process.env.SYSTEM_FAULT_POINT;
const pause = async envelope => {
  process.send?.({ event: 'fault', point, orderId: envelope.body.orderId });
  await new Promise(() => {});
};
let worker, recovery, app;
if (name === 'inventory') {
  const service = new InventoryService(pool);
  const handler = participantHandler(pool, name, (command, commit) => service.execute(command, async (db, result) => {
    await commit(db, result);
    if (point === 'before_commit') await pause({ body: command });
  }));
  worker = new RabbitWorker(pool, name, async envelope => {
    await handler(envelope);
    if (point === 'after_commit_before_ack') await pause(envelope);
  }, { url: process.env.RABBITMQ_URL, prefix: process.env.RABBITMQ_PREFIX });
  app = inventoryApp(service, readiness(pool, worker));
} else {
  const service = new BrokerOrderService(pool, 1000, 30000);
  recovery = new RecoveryWorker(service);
  worker = new RabbitWorker(pool, 'orders', async envelope => {
    await service.receive(envelope);
    if (point === 'after_commit_before_ack') await pause(envelope);
  }, { url: process.env.RABBITMQ_URL, prefix: process.env.RABBITMQ_PREFIX });
  app = orderApp(service, readiness(pool, worker, recovery));
}
worker.start(); recovery?.start();
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT) });
process.on('SIGTERM', () => {
  server.close(() => { void (async () => { await recovery?.stop(); await worker.stop(); await pool.end(); process.disconnect?.(); })(); });
});
