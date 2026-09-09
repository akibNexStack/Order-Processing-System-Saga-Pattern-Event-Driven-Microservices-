# RabbitMQ messaging

RabbitMQ carries saga commands and results between the four services. HTTP remains the frontend/Postman interface.

## Delivery design

- Durable exchanges and quorum queues route commands to participants and results to orders.
- Each service has a transactional outbox for pending publications and an inbox for received-message deduplication.
- Consumers acknowledge processed messages; retry and dead-letter queues handle delivery failures.
- Message IDs identify attempts. Business idempotency keys stay stable across retries.
- Result correlation prevents old or unrelated replies from advancing a saga.
- Malformed or exhausted messages are quarantined instead of retried forever.

## Configuration and limits

Set the same `RABBITMQ_URL` and `RABBITMQ_PREFIX` on all services. Hosted connections use the full `amqps://` URL, including the virtual-host path.

Delivery is at least once, not exactly once. Outboxes, receipts, and provider keys make repeated delivery safe. Single-node queues are not a multi-host high-availability deployment. Hosting must support the required quorum-queue features.

**Check:** `npm run test:messaging`.
**Next:** [recovery](PART_9_RECOVERY.md), [runbook](PART_10_VALIDATION.md).
