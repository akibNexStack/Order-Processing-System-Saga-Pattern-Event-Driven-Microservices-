# Implementation Plan

Build this in **10 parts**, completing each part’s goal before moving forward.

## Part 1 — Define contracts and business rules

**Status:** Implemented. Contracts, business rules, and provider simulations are documented in [Part 1 contracts](docs/PART_1_CONTRACTS.md). Run `npm run check` to verify.

- Define the order payload: customer, items, quantities, amount, currency, and shipping address.
- Define commands and results for payment, inventory, and shipping.
- Add shared TypeScript types and Zod schemas.
- Define saga statuses, step names, and idempotency-key rules.
- Define simulated payment and shipping providers for local development.

**Goal:** Every service agrees on the data it sends, receives, and validates.

## Part 2 — Design databases and migrations

**Status:** Implemented. See [database design and verification](docs/PART_2_DATABASES.md). Run `npm run check:all` to verify contracts and real PostgreSQL integration tests.

- Payment: payment records and refund records.
- Inventory: products, available stock, and reservations.
- Shipping: shipment records and cancellation status.
- Orchestrator: orders, saga instances, and transition history.
- Add unique constraints, indexes, and seed inventory.

**Goal:** Each service owns a working database, with repeatable migrations and sample data.

## Part 3 — Implement Payment Service

- Implement charge, refund, and payment-status endpoints.
- Make charges and refunds idempotent.
- Reject reuse of an idempotency key with a different payload.
- Add controlled payment failures for testing.
- Handle provider retries using a stable provider idempotency key.

**Goal:** Repeated or simultaneous requests produce one charge; repeated refunds produce one refund.

## Part 4 — Implement Inventory Service

- Implement reserve, release, and reservation-status endpoints.
- Reserve all items in an order within one local transaction.
- Prevent overselling using atomic updates or row locking.
- Make reservation and release operations idempotent.
- Define reservation expiry and finalization rules so completed orders cannot lose their stock.

**Goal:** Concurrent orders cannot reserve more stock than exists, and failed orders release their reservations.

## Part 5 — Implement Shipping Service

- Implement shipment creation, cancellation, and status endpoints.
- Make creation and cancellation idempotent.
- Add controlled shipping failures.
- Define which shipment states permit cancellation.

**Goal:** Duplicate requests create one shipment, and eligible shipments can be safely cancelled.

## Part 6 — Implement HTTP orchestration

- Add `POST /orders` and `GET /orders/:id`.
- Persist the order and saga before starting work.
- Execute **Payment → Inventory → Shipping**.
- Persist each transition and completed step.
- Make order creation idempotent.
- Prevent concurrent workers from advancing the same saga twice.

**Goal:** A successful order reaches `COMPLETED`, with its progress visible in the database and status endpoint.

## Part 7 — Implement compensation

- Record compensation progress separately from forward progress.
- Compensate completed steps in reverse order.
- Refund payment when inventory reservation fails.
- Release inventory, then refund payment, when shipping fails.
- Retry failed compensations; keep the saga `COMPENSATING` until cleanup succeeds.
- Treat timeouts as uncertain outcomes and reconcile them before deciding what to undo.

**Goal:** Every forced business failure produces the correct cleanup, and `FAILED` means compensation has finished.

## Part 8 — Move the saga to RabbitMQ

- Define exchanges, queues, routing keys, and validated message envelopes.
- Replace service-to-service HTTP calls with commands and result events.
- Add a transactional outbox to reliably publish committed database changes.
- Add consumer deduplication and acknowledge messages after processing commits.
- Handle duplicate, delayed, and out-of-order messages.
- Configure bounded retries and dead-letter queues.

**Goal:** The complete saga runs through RabbitMQ without losing work between database commits and message publishing.

## Part 9 — Add recovery and observability

- Recover stale `IN_PROGRESS` and `COMPENSATING` sagas.
- Use persisted deadlines, retry counts, and worker leases.
- Resume pending commands, compensation, and unpublished outbox messages.
- Add structured logs with order, saga, and message IDs.
- Add readiness checks and a readable order history.
- Surface cases requiring manual intervention.

**Goal:** Restarting a service or the orchestrator resumes unfinished work without duplicate business effects.

## Part 10 — Validate and document

- Test successful orders and failure at every step.
- Test concurrent duplicate requests and stock contention.
- Test failed refunds and inventory releases.
- Test crashes around database commits and message acknowledgements.
- Test broker outages, redelivery, and recovery.
- Document startup, migrations, sample requests, and troubleshooting.

**Goal:** A repeatable test suite proves successful completion, correct compensation, and crash recovery.

## Milestones

1. **Part 7:** A complete HTTP-based saga.
2. **Part 10:** A verified event-driven implementation with recovery.
