# Part 6 — Persisted HTTP orchestration

> The running services now use [Part 8 RabbitMQ transport](PART_8_MESSAGING.md).
> This document describes the earlier HTTP implementation retained for regression tests.


## Start the complete forward flow

From the repository root, with the service `.env` files configured:

```bash
npm run infra:up
npm run migrate
npm run db:seed
npm run dev
```

The orchestrator defaults to payment at `http://localhost:3001`, inventory at
`http://localhost:3002`, and shipping at `http://localhost:3003`. Override these using
`PAYMENT_SERVICE_URL`, `INVENTORY_SERVICE_URL`, and `SHIPPING_SERVICE_URL` in the
orchestrator environment. `SERVICE_TIMEOUT_MS` defaults to 10000 per HTTP operation
(range 1–60000). Participant provider deadlines default to 5000.

In another terminal at the root:

```bash
curl -i http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  --data-binary @examples/orders/create.json
```

This calls payment, inventory, shipping, and inventory finalization in sequence. A
successful fresh request returns 201 with `saga.status: COMPLETED` and a `Location`
header containing `/orders/<orderId>`. Use the returned order ID:

```bash
curl http://localhost:3000/orders/<orderId>
curl -X POST http://localhost:3000/orders/<orderId>/resume
```

Replace `<orderId>` before running these commands. Repeating the original order POST
with the same customer/key/payload returns the same order and resumes unfinished
forward work or compensation. A completed replay returns 200. Use a new checkout key for a genuinely
new order; the server generates its order and saga IDs.

## Scope and failure behavior

**Part 6 provides forward orchestration; [Part 7](PART_7_COMPENSATION.md) adds compensation to this flow.**

| Outcome | Persisted behavior |
| --- | --- |
| All forward steps and inventory finalization succeed | COMPLETED |
| Confirmed payment decline before any successful step | FAILED |
| Inventory or shipping business rejection after earlier success | Automatically compensate; FAILED after cleanup, COMPENSATING while cleanup is pending |
| HTTP timeout, unavailable service, malformed/mismatched response | IN_PROGRESS at the same operation; retry the same command |
| Finalization rejection or unexpected business conflict | IN_PROGRESS for inspection/reconciliation |

COMPENSATING orders release completed inventory reservations and refund payments in
reverse order. A failed or uncertain cleanup attempt stays COMPENSATING; repeat the
original POST or use `/resume` to retry. See Part 7 for the full failure policy.

IN_PROGRESS and COMPENSATING recovery is request-driven: repeat POST `/orders` or explicitly POST
`/orders/:orderId/resume`. Background recovery remains Part 9. GET is read-only.
`nextAttemptAt` and lease fields are persisted groundwork for Part 9; explicit resumes
can run immediately and do not wait for the scheduled time. No RabbitMQ messages are
used by this flow; event-driven transport comes in Part 8.

## API responses

| Status | Meaning |
| --- | --- |
| 201 | New order completed during this request |
| 200 | Completed replay/resume, or a successful GET |
| 202 | Work remains IN_PROGRESS or COMPENSATING |
| 400 | Invalid JSON/order payload/order ID |
| 404 | Unknown order |
| 409 | Customer idempotency key reused with changed payload |
| 413 | Order request exceeds 32 KiB |
| 415 | Missing/unsupported Content-Type |
| 422 | Terminal FAILED saga: no successful steps, or all required compensation confirmed |
| 503 | Database/service error; retry the original key or known order ID |

Responses include the order, item rows, saga state, ordered transition history, and
`requiresCompensation`. 202/503 include `Retry-After: 1`. `Location` is set after order
acceptance, including errors encountered during subsequent forward execution.

The endpoints are internal development APIs without authentication. Customer scoping
means the idempotency constraint uses customerId plus key; it does not verify customer
identity. Amounts are the demo's submitted quote, not prices calculated from a catalog.
Payment and shipping still use their local durable simulators.

## Durable order acceptance and progress

1. Validate and normalize customer/product UUIDs, item order, and address whitespace.
   Hash the normalized payload; object property order is irrelevant.
2. Insert the order using the customer/key uniqueness constraint. A matching existing
   fingerprint returns the existing order; changed payload returns a conflict.
3. Insert item rows, saga payload snapshot, and initial ORDER_ACCEPTED transition in
   the same transaction. No service call occurs before that transaction commits.
4. Acquire a nonblocking per-order PostgreSQL session advisory lock. Concurrent
   orchestrators cannot drive the same order simultaneously; losers return its current
   state. No database transaction remains open across HTTP calls.
5. Validate persisted progress against the next operation. Persist COMMAND_DISPATCHED
   before sending the command, using a stable `commandKey(sagaId, operation)`.
6. Validate the HTTP status, result schema, and correlation metadata. Advance only on
   a matching confirmed result. Store status, current operation, completed steps,
   last result, and transition history together in a local transaction.
7. Every transition checks the previous saga version and increments it. Its sequence
   matches the new version, preventing duplicate history rows and stale state writes.
8. Release the advisory lock in finally; discard a connection if unlocking fails.
   If execution stops after a service commits but before the orchestrator records it,
   resume reissues the same command key and the participant returns its saved outcome.

The session advisory lock is the active exclusion mechanism. Persisted lease metadata
is diagnostic/future recovery groundwork and does not replace that lock. All writers
must follow the version/locking protocol. Inconsistent stored step/completion state
is rejected before dispatch instead of skipping work.

## Inventory finalization boundary

The forward commands are:

1. CHARGE_PAYMENT (PAYMENT)
2. RESERVE_INVENTORY (INVENTORY)
3. CREATE_SHIPMENT (SHIPPING)
4. FINALIZE_INVENTORY (completion action, currentStep remains SHIPPING)

`completedSteps` tracks the three business steps. `currentOperation` distinguishes
shipment creation from inventory finalization. The saga becomes COMPLETED only after
FINALIZE_INVENTORY succeeds and `inventoryFinalized` is saved as true.

If finalization succeeds remotely but its response or the final database write is
lost, the saga remains at FINALIZE_INVENTORY. Resume replays finalization and records
completion. It must not compensate a finalized reservation because of a lost response.
Confirmed finalization rejection remains visible for reconciliation rather than
triggering automatic reversal. Part 7 retains this completion policy.

## Verification

```bash
npm run test:orchestrator
npm run check:all
```

The orchestration suite creates temporary databases on all four PostgreSQL instances,
applies their migrations, and runs actual participant HTTP servers on ephemeral ports.
It closes every server and drops only its own databases afterward. Connection overrides
are `TEST_PAYMENT_DATABASE_URL`, `TEST_INVENTORY_DATABASE_URL`,
`TEST_SHIPPING_DATABASE_URL`, and `TEST_ORDER_DATABASE_URL`; otherwise service `.env`
URLs are used. Database users need CREATEDB privileges as in earlier test suites.

Tests cover the complete HTTP checkout, persistence before calls, concurrent duplicate
orders across orchestrator instances, payload conflicts and customer-scoped keys,
atomic acceptance rollback, ordered transitions, lost responses, state-write failures
after remote success, payment decline, later-step reverse-order compensation, finalization
response/write failures, shipping-stage resume, finalization rejection, malformed HTTP
results, deadlines, inconsistent persisted progress, and real HTTP order/status calls.

These verify forward orchestration, compensation, and retry boundaries. Background
recovery and full process-kill recovery testing remain later implementation parts.

References: [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and
[Node HTTP timeout signals](https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay).
