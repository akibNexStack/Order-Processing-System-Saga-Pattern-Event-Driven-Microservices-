# Part 8 — RabbitMQ saga transport

Service startup now runs the saga through RabbitMQ commands and result events.
HTTP remains the public order/status interface and the participant development API.
The previous HTTP orchestrator remains available in code for regression tests; the
running order service uses `BrokerOrderService` and makes no participant HTTP calls.

## Run and observe an order

From the project root:

```bash
npm run infra:up
npm run migrate
npm run db:seed
npm run dev
```

In another terminal:

```bash
curl -i http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  --data-binary @examples/orders/create.json
curl http://localhost:3000/orders/<orderId>
```

Replace `<orderId>` with the returned ID. New work normally returns **202** immediately;
poll GET until the saga is COMPLETED or FAILED. A completed replay returns 200;
a terminal failed replay returns 422. Order acceptance works while RabbitMQ is offline:
the first command stays in PostgreSQL until a publisher can confirm delivery.

All services use `RABBITMQ_URL` (default `amqp://saga:saga@localhost:5672`) and the same
`RABBITMQ_PREFIX` (default `saga.v1`). HTTP service URL and timeout variables from
Part 6 no longer control the running orchestrator. Payment/shipping simulation modes
still work. Existing `.env` files use the new prefix default without changes.

RabbitMQ management is at http://localhost:15672 with local credentials saga/saga.

## Topology and contracts

| Resource | Purpose |
| --- | --- |
| `saga.v1` durable direct exchange | Routes payment, inventory, shipping commands and orders results |
| `saga.v1.{payment,inventory,shipping,orders}` | Durable quorum consumer queues, manual acknowledgements, prefetch 1 |
| `saga.v1.<consumer>.retry` | One-second retry queue; routes back to the original consumer |
| `saga.v1.dead` exchange and `saga.v1.<consumer>.dead` queues | Durable quarantine for invalid/exhausted messages |

Retry queues use quorum at-least-once dead-lettering with reject-publish overflow.
Main queues also dead-letter after a delivery limit of five unexpected requeues.
These are local single-node quorum queues, not a replicated deployment across hosts.

The strict envelope contains version 1, a UUID messageId, creation time, a COMMAND or
RESULT kind, and the existing validated command/result body. Results carry a
`causationId` matching the exact command delivery attempt. Message IDs distinguish
attempts; `commandKey(sagaId, operation)` remains stable across all business retries.
Consumers validate the AMQP message ID, content type, size limit, envelope, destination,
and correlation. Malformed or conflicting messages go to a dead-letter queue.

## Durability and deduplication

Every database now owns `message_outbox` and `message_inbox`. Migrations add these
tables; the orchestrator also gains `pending_message_id` and `broker_attempts`.

Order acceptance, the initial saga/history, and its first command outbox row commit
in one transaction. Each result consumer locks the saga row, records its inbox ID,
advances the saga/history, and writes the next command in one transaction. There is
no database-to-broker publish gap in a committed saga transition.

Participant completion transactions include their command receipt and result outbox
through a commit hook. Existing provider intent/reconciliation writes remain durable
before external work. If a process stops after provider success, replay uses the
existing provider key and saved result. Early replay and UNKNOWN paths write inbox
and result outbox before acknowledging the incoming command. An outbox failure never
acknowledges away the only incoming command that can recover the result.

The relay locks pending rows with SKIP LOCKED, publishes persistent mandatory messages,
waits for publisher confirmation, then marks them published. An unroutable return,
closed connection, or confirmation timeout leaves the row pending. If confirmation
arrives but the database commit fails, the relay republishes the same message ID;
consumers deduplicate it. Inbox IDs are stored with canonical content fingerprints,
so a changed payload cannot masquerade as an already processed message.

Result processing also verifies the original committed command and pending attempt.
Stale results cannot rewind an advanced saga or complete a newer attempt. Broker
reconnection and outbox polling run while each service is running. No HTTP request
needs to remain open for the saga to advance.

## Retries, failure, and compensation

Business rejections still follow Part 7: inventory rejection refunds; shipping
rejection releases inventory then refunds. FAILED means all required cleanup has
finished. Uncertain finalization never triggers compensation.

There are two bounded retry mechanisms:

1. A handler exception retries through the one-second queue, up to three processing
   attempts. Invalid messages go directly to the dead-letter queue. Republish is
   confirmed before the original delivery is acknowledged.
2. A valid UNKNOWN result or unsuccessful compensation produces another command
   attempt via the transactional outbox, with increasing delay (one then two seconds).
   After three attempts, the result is copied to the orders dead-letter queue and
   the saga remains IN_PROGRESS or COMPENSATING. `pendingMessageId` is null and
   `brokerAttempts` is 3. POST `/orders/:orderId/resume` starts another bounded cycle.

Service unavailability retains pending commands rather than pretending they failed.
A command quarantined after handler errors remains unfinished. Part 9 can reconcile
a missing response within its bounded budget; persistent failures require intervention.
The same message and business IDs must be retained when redriving. Do not purge queues
or delete deduplication records to retry an order.

[Part 9](PART_9_RECOVERY.md) now implements stale-saga scans, missing-result deadlines,
readiness, history, and intervention handling. Outbox reconnection is implemented here
because durable messaging needs it; it is not a complete recovery worker. Outbox and
inbox retention/archival are not yet implemented. Payment and shipping remain durable
local provider simulations.

## Verification

```bash
npm run test:messaging
npm run check:all
```

Tests use real RabbitMQ with unique exchanges/queues and temporary databases on all
four PostgreSQL instances. They remove their own resources afterward. Override broker
access with `TEST_RABBITMQ_URL`; database overrides match earlier integration suites.
The full check includes the HTTP regression suites as well as RabbitMQ integration.

Messaging guarantees follow RabbitMQ's [acknowledgement and confirmation rules](https://www.rabbitmq.com/docs/confirms)
and [quorum queue dead-lettering guidance](https://www.rabbitmq.com/docs/quorum-queues).

Verification on 2026-09-07: `npm run check:all` passed all workspace builds and
type checks, shared contracts (26), database tests (18), payment (18), inventory
(16), shipping (20), HTTP orchestration (31), and RabbitMQ integration (18).
Counts include parent tests; RabbitMQ covers 17 individual scenarios. There were
no failures or skips. All four local databases migrated successfully, and
`npm run db:generate` reported no remaining schema changes.
