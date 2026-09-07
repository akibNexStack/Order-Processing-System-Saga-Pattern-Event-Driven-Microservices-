# Part 4 — Inventory Service

## Run and try it

From the repository root, with service `.env` files configured:

```bash
npm run infra:up
npm run build --workspace @saga/shared
npm run migrate --workspace inventory-service
npm run db:seed
npm run dev --workspace inventory-service
```

In a second terminal at the root:

```bash
curl -i http://localhost:3002/inventory/reserve \
  -H 'Content-Type: application/json' \
  --data-binary @examples/inventory/reserve.json

curl http://localhost:3002/inventory/reservations/11111111-1111-4111-8111-111111111111

# Failure path: release the reservation
curl -i http://localhost:3002/inventory/release \
  -H 'Content-Type: application/json' \
  --data-binary @examples/inventory/release.json
```

The sample reserves two demo keyboards and one demo mouse. Repeat requests unchanged
for idempotent replay. Use fresh order/saga IDs and keys for a fresh purchase after
release. Seed reruns do not replenish consumed stock.

For the success path, send this **instead of releasing**, after successful shipping:

```bash
curl -i http://localhost:3002/inventory/finalize \
  -H 'Content-Type: application/json' \
  --data-binary @examples/inventory/finalize.json
```

The samples use the same order/saga IDs as the payment examples. They demonstrate
individual service actions, not an implemented orchestrator.

## Endpoints and commands

| Endpoint | Contract |
| --- | --- |
| GET /health | Process liveness |
| POST /inventory/reserve | RESERVE_INVENTORY with items |
| POST /inventory/release | RELEASE_INVENTORY with empty payload |
| POST /inventory/finalize | FINALIZE_INVENTORY with empty payload |
| GET /inventory/reservations/:orderId | Current reservation and item rows |

All commands use the Part 1 metadata: version, orderId, sagaId, idempotencyKey,
operation, and payload. Part 4 adds FINALIZE_INVENTORY to the shared command/result
schemas; success returns `{ status: 'FINALIZED', reservationId }`.

POST responses: 200 success; 422 insufficient stock (including missing products);
409 key/ownership conflicts or invalid lifecycle operation; 400 invalid JSON/schema;
415 unsupported Content-Type; 413 body over 32 KiB. Status reads return 400 for an
invalid UUID and 404 for an unknown order. Database/lock-timeout errors return 503
with `Retry-After: 1`; retry the original key because a lost response may follow a
successful commit. No provider or message broker is called by inventory operations.

Endpoints are internal development APIs. Existing order/saga ownership is checked,
but there is no authentication layer or proof of shipping success at this boundary;
the future orchestrator must authorize and sequence finalization.

## Transaction and idempotency rules

- Validate before writes. Normalize UUIDs to lowercase and sort items by product ID
  before fingerprinting. Equivalent reordered baskets replay safely; quantities and
  product identities cannot change. Duplicate product IDs are rejected by Zod.
- One PostgreSQL transaction contains the command receipt, reservation/item changes,
  stock updates, and final result. Database rollback undoes every change together.
- Acquire a transaction advisory lock for the order, then insert the receipt first.
  Its primary key enforces service-wide idempotency across operation types and orders.
  A mismatched fingerprint returns a conflict without modifying the original receipt.
- Lock product rows in ascending UUID order for both reserve and release. Check every
  requested product while holding locks before decrementing any available stock.
  Different orders contend on the same rows; no two orders can spend the same stock.
- Missing/insufficient stock records a FAILED reservation and saved failure result,
  with no item rows and no stock changes. Later replenishment does not change the
  outcome of that order, even with a different request key; use a fresh order to retry
  a declined purchase. Store the original reserve fingerprint to reject changed items.
- Duplicate commands replay their original historical results even after a lifecycle
  change. GET is the current-state view. A new reserve key cannot reopen a released
  order, and a new key with unchanged items cannot reserve stock twice.
- Release restores exactly the persisted reserved quantities, once, and retains item
  rows as history. Releasing a missing/failed/already-released order is a safe NOOP.
  Missing-order release persists a RELEASED marker to block delayed reserve commands.
- Recreating service objects does not reset state. Lock waits are capped at five
  seconds; lock/database failures leave callers able to retry the original command.
- Stock must not be modified through uncoordinated writers. Product foreign keys and
  nonnegative-stock constraints are additional safeguards, not replacements for these
  transactions. Existing legacy PENDING or inconsistent rows may require reconciliation.

## Finalization and expiry policy

The supported lifecycle is:

- Reserve success: RESERVED; stock is held and unavailable to other orders.
- Reserve rejection: FAILED; no stock held.
- Compensation: RESERVED → RELEASED; stock returned once.
- Successful order completion: RESERVED → FINALIZED; stock stays unavailable/sold.
- FINALIZED is terminal for these saga operations: release returns INVALID_STATE.
  Customer returns/restocking after fulfillment need a separate future business flow.

Finalization is idempotent. Concurrent finalize/release operations serialize; only one
can succeed. The orchestrator must request finalization only after shipping succeeds
and before recording COMPLETED. If finalization's response or the final order-state
write is lost, retry/read and finish the successful order. Do not compensate a known
finalized reservation as if finalization had failed.

**Automatic expiry is disabled.** Service-created reservations use `expiresAt: null`;
there is no timer or expiry worker. This prevents a clock deadline from returning stock
belonging to a successfully completed order. Failed orders require explicit release,
and abandoned orders require the later recovery worker. Do not enable expiry until
its coordination with in-flight shipping/finalization and recovery is implemented.
The retained schema field is reserved for that future coordinated policy.

## Verification

```bash
npm run test:inventory
npm run check:all
```

Inventory tests use a temporary PostgreSQL database and remove it afterward. They use
`TEST_INVENTORY_DATABASE_URL` or the inventory `.env` connection to find an existing
administrative database; the user needs CREATEDB privileges. Development data is not
cleared. The real HTTP test uses an ephemeral port and closes its server.

Coverage includes validation, finalization contracts, stable replay after service
recreation, concurrent duplicate reserve/release, cross-order overselling, all-or-none
baskets, missing products, saved failures after replenishment, key/ownership conflicts,
reordered baskets, opposite lock ordering, release-before-reserve, finalization,
injected reserve/release transaction failures, lifecycle races, and real HTTP calls.
These are inventory service tests; end-to-end order orchestration remains Part 6.
