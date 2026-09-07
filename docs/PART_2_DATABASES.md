# Part 2 — Database schemas and migrations

## Ownership

Each service owns a separate PostgreSQL instance and its own Drizzle migration journal.
There are no cross-service foreign keys. Order and saga UUIDs in participant databases
are correlation identifiers; their ownership must be checked by the service handlers.

| Service | Local port | Tables |
| --- | --- | --- |
| Payment | 5433 | payments, refunds, command_receipts; Part 3 adds two simulated_provider_* tables |
| Inventory | 5434 | products, reservations, reservation_items, command_receipts |
| Shipping | 5435 | shipments, shipment_cancellations, command_receipts |
| Orchestrator | 5436 | orders, order_items, saga_instances, saga_transitions |

Definitions live in each service's `src/db/schema.ts`. Generated SQL and Drizzle
snapshots/journals live in its `drizzle/` directory and must be committed together.
`src/db/client.ts` exposes `createDatabase(connectionString)` with the typed Drizzle
client and its underlying pool. Call `pool.end()` when a CLI or service shuts down.
Importing schemas or the factory does not connect to a database.

## Design rules

- Money uses PostgreSQL `bigint` minor units, bounded to 1–9,999,999,999, and currency
  is restricted to USD/BDT. Drizzle maps this bounded range exactly to JavaScript
  numbers. Raw node-postgres queries return bigint as strings. This replaces the
  README's original illustrative decimal column and matches Part 1's wire format.
- One forward payment, reservation, or shipment exists per order. Provider transaction
  and shipment identifiers are also unique when supplied.
- Each participant has a command receipt ledger with a primary-key idempotency key,
  SHA-256 fingerprint, operation, order/saga IDs, processing state, and saved result.
  Insert-first uniqueness is tested with simultaneous database connections. A completed
  receipt requires a JSON object result; full result validation still uses Part 1 Zod
  schemas. PROCESSING receipts have no final result and support later reconciliation.
- Refund/cancellation rows may have a null original-record ID, allowing a no-op marker
  before the forward action completes. When a reference exists, a composite foreign
  key ensures it belongs to the same order. Future handlers must check these markers
  before applying delayed forward work, including races with provider calls.
- Inventory tracks available stock and a separate reservation ledger. Available stock
  cannot be negative; item quantities must be 1–10,000. Each product appears once in
  each reservation. Foreign keys preserve reservation/product relationships.
- Inventory `FINALIZED` and optional expiry fields reserve room for Part 4's lifecycle.
  No worker expires reservations yet. Reservation changes and stock changes must occur
  in one transaction; constraints alone do not implement reservation bookkeeping.
- Checkout idempotency keys are unique per customer. Order items have local order
  foreign keys; product IDs deliberately have no cross-database foreign key.
- Saga status is stored in `saga_instances`, avoiding a second order-status field that
  could drift. It stores the validated payload snapshot, current step, forward and
  compensation progress, optimistic version, attempts, retry time, and worker lease.
  Recovery indexes cover status/time lookups. Lease owner/expiry must be set together.
- Saga transitions have a unique positive sequence per saga, status/step/direction,
  JSON details, and a timestamp. State and history must be written in the same local
  transaction in Part 6. The database checks vocabulary and references, but does not
  implement legal state transitions or require a gapless transition sequence.
- All timestamps use time zones. Creation/update fields default to insertion time;
  future update queries must explicitly set `updatedAt`. There are no hidden triggers.
- JSON columns enforce basic shape; typed Drizzle JSON is compile-time guidance, not
  runtime validation. Validate payloads, addresses, items, and results with shared Zod
  schemas before writes. Collection size across order/reservation item rows, progress
  ordering/uniqueness, terminal-state consistency, and snapshot consistency are service
  transaction responsibilities.
- Foreign keys use restrictive deletion behavior. There are no cascading deletes of
  financial or saga history. Authentication, provider execution, state-machine handlers,
  outbox publishing, and recovery workers remain for later parts.

## Local setup

Ensure service `.env` files exist (copy their `.env.example` files on a fresh checkout),
then run from the root:

```bash
npm install
npm run infra:up
npm run migrate
npm run db:seed
```

`migrate` applies pending migrations only. Rerunning it is safe. The inventory seed
inserts missing demo products without updating existing rows or replenishing stock.
It runs in a transaction and also tolerates repeated runs.

| Product ID | SKU | Initial available stock |
| --- | --- | --- |
| 44444444-4444-4444-8444-444444444444 | DEMO-KEYBOARD | 100 |
| 55555555-5555-4555-8555-555555555555 | DEMO-MOUSE | 50 |
| 66666666-6666-4666-8666-666666666666 | DEMO-MONITOR | 0 |

The first ID matches Part 1's example request. The zero-stock product supports later
failure scenarios. SKU or ID conflicts are left untouched; this seed is additive,
not a reset or reconciliation tool.

After editing a schema, generate and review a new migration:

```bash
npm run db:generate
npm run migrate
```

Do not edit migrations already applied to a shared environment. Create a new migration
instead. Drizzle migration files and metadata are tracked; local data lives in Docker
volumes. `npm run infra:down` preserves those volumes.

## Verification

```bash
npm run check       # Type checks, builds, Part 1 tests
npm run test:db     # Builds and real PostgreSQL integration tests
npm run check:all   # Both suites
```

Database tests create a randomly named `saga_test_<uuid>` database on each configured
instance, apply migrations twice, verify constraints/concurrency/seed behavior, then
drop only the databases they created. They do not clear or modify development tables.
The test database user needs CREATEDB privileges; the local Compose user has them.
Connection failures fail the suite instead of silently skipping it.

By default tests use the service `.env` connection URL. Override individual test
connections with `TEST_PAYMENT_DATABASE_URL`, `TEST_INVENTORY_DATABASE_URL`,
`TEST_SHIPPING_DATABASE_URL`, and `TEST_ORDER_DATABASE_URL`. Each URL connects to an
existing administrative database; tests create a separate database on that instance.

Coverage includes migration reruns, database ownership, concurrent duplicate receipt
inserts, money limits, invalid currencies/statuses, foreign keys, no-op compensation
records, seed reruns, stock constraints, rollback, conditional stock updates under
contention, checkout-key scoping, saga version contention, and transition uniqueness.
These checks prove database foundations, not completed service business workflows.

Implementation references: [Drizzle constraints](https://orm.drizzle.team/docs/indexes-constraints)
and [migration workflow](https://orm.drizzle.team/docs/migrations).
