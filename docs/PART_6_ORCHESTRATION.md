# Order orchestration

The order service persists checkout and coordinates payment → inventory reservation → shipping → inventory finalization.

| Endpoint | Purpose |
| --- | --- |
| `POST /orders` | Accept or replay checkout |
| `GET /orders/:orderId` | Order and saga state |
| `GET /orders/:orderId/history` | Persisted transition history |
| `GET /orders/attention` | Up to 100 intervention records |
| `POST /orders/:orderId/resume` | Request recovery of unfinished work |

## Behavior

- The running service sends commands through [RabbitMQ](PART_8_MESSAGING.md), not participant HTTP calls.
- Order acceptance and pending work are persisted before background processing.
- A 202 response means pending, not completed. Poll GET for the terminal result.
- Same-key checkout retries do not create another order; conflicting payloads are rejected.
- Completion requires inventory finalization, not only successful shipping.
- GET requests are read-only. [Recovery](PART_9_RECOVERY.md) advances interrupted work.

The earlier HTTP coordinator is retained for regression tests; it is not the deployed transport.

**Checks:** `npm run test:orchestrator` and `npm run test:messaging`.
