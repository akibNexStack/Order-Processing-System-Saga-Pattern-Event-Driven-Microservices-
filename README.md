# Order Processing System — Saga Pattern (Event-Driven Microservices)

A distributed order-processing system built to demonstrate how to safely coordinate a multi-step business transaction (**Payment → Inventory → Shipping**) across independent microservices, each owning its own database, using the **Saga pattern** with an **orchestrator**.

Built with **Hono**, **TypeScript**, **PostgreSQL**, and **RabbitMQ**.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Why a Distributed Transaction Can't Use a Normal DB Transaction](#2-why-a-distributed-transaction-cant-use-a-normal-db-transaction)
3. [Solution: The Saga Pattern](#3-solution-the-saga-pattern)
4. [Architecture](#4-architecture)
5. [Core Concepts You Must Get Right](#5-core-concepts-you-must-get-right)
6. [Tech Stack](#6-tech-stack)
7. [Project Structure](#7-project-structure)
8. [Database Schema](#8-database-schema)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Local Development Setup](#10-local-development-setup)
11. [Testing Strategy](#11-testing-strategy)
12. [Interview / Design-Review Talking Points](#12-interview--design-review-talking-points)

---

## 1. Problem Statement

E-commerce checkout is not a single operation — it's a *sequence of operations across separate systems*:

```
1. Charge the customer's card         (Payment Service)
2. Reserve stock for the order        (Inventory Service)
3. Create a shipment                  (Shipping Service)
```

In a real system, each of these lives in its **own service with its own database**, because:
- They scale differently (payment traffic ≠ shipping traffic)
- They're owned by different teams
- They have different reliability/compliance requirements (payment data is far more sensitive than shipping data)

The problem: **what happens when step 2 or step 3 fails after step 1 already succeeded?**

The customer has been charged, but there's no stock. Without a coordination mechanism, the system is left in an inconsistent state — money has moved, but the order can never complete. This is the core problem this project solves.

---

## 2. Why a Distributed Transaction Can't Use a Normal DB Transaction

In a monolith with one database, this is trivial:

```sql
BEGIN;
  UPDATE wallets SET balance = balance - 100 WHERE user_id = 1;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 5;
  INSERT INTO shipments (...) VALUES (...);
COMMIT; -- all or nothing, guaranteed by the database (ACID)
```

If any statement fails, `ROLLBACK` undoes everything. The database guarantees atomicity for free.

This guarantee **does not exist across services**. A `BEGIN/COMMIT` block cannot span three independent PostgreSQL instances behind three independent HTTP APIs. There is no built-in atomicity. Two-phase commit (2PC) exists in theory but is avoided in practice — it requires all participants to be online and voting simultaneously, which kills availability and doesn't work with third-party services like a payment gateway.

**We need a way to get "all or nothing" behavior without a shared transaction.**

---

## 3. Solution: The Saga Pattern

A **saga** breaks the transaction into a sequence of local transactions, each with a **compensating action** — an operation that semantically undoes it.

| Step | Forward Action | Compensating Action |
|---|---|---|
| Payment | Charge card | Refund |
| Inventory | Reserve stock | Release stock |
| Shipping | Create shipment | Cancel shipment |

If step *N* fails, the saga runs the compensating actions for steps `1..N-1` **in reverse order**, bringing the system back to a consistent (though not identical) state.

### Choreography vs. Orchestration

| | Choreography | Orchestration |
|---|---|---|
| Control | Decentralized — each service reacts to events and emits the next one | Centralized — one orchestrator issues commands and tracks state |
| Visibility of the flow | Scattered across services | Lives in one place |
| Debuggability | Hard — you have to reconstruct the flow from logs across services | Easy — the orchestrator's state table tells you exactly where an order is |
| Best for | Small number of steps, simple reactions | Multi-step flows with branching failure handling (our case) |

**Decision: Orchestration.** With 3+ steps and non-trivial compensation logic, a central orchestrator keeps the system understandable and debuggable — this is also the pattern most commonly asked about in system design interviews.

---

## 4. Architecture

```
                        ┌──────────────────────────┐
                        │   Order Orchestrator      │
                        │  (owns saga state machine)│
                        └─────────────┬─────────────┘
                                      │ commands / listens for events
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
        ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │ Payment Service │  │ Inventory Service │  │ Shipping Service │
        │  (own Postgres) │  │   (own Postgres)  │  │   (own Postgres) │
        └────────────────┘  └──────────────────┘  └──────────────────┘
                 │                    │                    │
                 └────────────────────┴────────────────────┘
                              RabbitMQ (event bus)
```

### Saga State Machine

```
IN_PROGRESS(PAYMENT)
        │ success
        ▼
IN_PROGRESS(INVENTORY)
        │ success
        ▼
IN_PROGRESS(SHIPPING)
        │ success                  │ failure (any step)
        ▼                          ▼
    COMPLETED                COMPENSATING
                                    │ all compensations done
                                    ▼
                                 FAILED
```

---

## 5. Core Concepts You Must Get Right

These are the details that separate a toy implementation from a production-credible one.

### 5.1 Idempotency

Networks fail and retries happen. The orchestrator **will** send the same "charge payment" command more than once at some point (timeout, crash-and-resume, message redelivery). Every step must be safe to execute twice.

**Mechanism:** every command carries an `idempotency_key`. Each service enforces a `UNIQUE` constraint on that key at the database level and treats a duplicate key as "already handled — return the previous result," not "do it again."

### 5.2 Race Conditions on Duplicate Requests

If two identical requests arrive nearly simultaneously (before either has committed), a naive "check then insert" has a race window. The fix is **insert-first**: attempt the `INSERT` immediately, and let the database's `UNIQUE` constraint reject the second one — then read back and return the existing row instead of erroring.

### 5.3 Persistent Saga State (No In-Memory State)

The saga's current step and completed-steps list live in a database table (`saga_instances`), updated after every step — **never held only in memory**. If the orchestrator process crashes mid-saga, in-memory state is gone and the saga becomes "stuck": money charged, nothing else happened, and nothing will ever fix it automatically. Persisting state after every transition is what makes recovery possible.

### 5.4 Recovery / Resume

A background **recovery worker** periodically scans for sagas stuck in `IN_PROGRESS` past a timeout threshold and resumes them from their last known `current_step`, using the persisted `completed_steps` to decide what still needs to run or be compensated.

### 5.5 Compensation Is Not Rollback

A compensating action is a **new forward operation** (e.g., "issue a refund"), not a reversal at the database level. It must itself be idempotent, and it must handle the case where the original action never actually completed (e.g., refunding a payment that was never charged should be a safe no-op, not an error).

---

## 6. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| API framework | Hono | Lightweight, fast, TypeScript-first, works the same across Node/Bun/edge |
| Language | TypeScript | Type safety across service boundaries via shared types |
| Database | PostgreSQL (one instance per service) | Strong consistency within a service, `UNIQUE` constraints for idempotency |
| ORM | Drizzle ORM | Type-safe queries, lightweight, good migration story |
| Message broker | RabbitMQ | Reliable delivery, dead-letter queues, mature tooling for event-driven work |
| Validation | Zod | Runtime validation of commands/events at service boundaries |

---

## 7. Project Structure

```
saga-order-system/
├── services/
│   ├── payment-service/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── db/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── inventory-service/
│   ├── shipping-service/
│   └── order-orchestrator/
│       ├── src/
│       │   ├── saga/
│       │   │   ├── stateMachine.ts
│       │   │   ├── compensate.ts
│       │   │   └── recoveryWorker.ts
│       │   └── index.ts
│       └── package.json
├── docker-compose.yml        # Postgres instances + RabbitMQ
├── shared/                   # shared types/events between services
└── README.md
```

---

## 8. Database Schema

Part 2 provides service-owned Drizzle schemas and generated SQL migrations:

| Service | Tables | Schema |
|---|---|---|
| Payment | payments, refunds, command_receipts | [schema.ts](services/payment-service/src/db/schema.ts) |
| Inventory | products, reservations, reservation_items, command_receipts | [schema.ts](services/inventory-service/src/db/schema.ts) |
| Shipping | shipments, shipment_cancellations, command_receipts | [schema.ts](services/shipping-service/src/db/schema.ts) |
| Orchestrator | orders, order_items, saga_instances, saga_transitions | [schema.ts](services/order-orchestrator/src/db/schema.ts) |

Amounts use bounded integer minor units, matching Part 1 contracts. Command receipts
provide database uniqueness for idempotency; service handlers will implement atomic
business operations in subsequent parts. See [database design, seed data, and tests](docs/PART_2_DATABASES.md).

---

## 9. Implementation Roadmap

### Phase 1 — Independent Services
Build `payment-service`, `inventory-service`, `shipping-service` in isolation. Each exposes a forward action and a compensating action, both idempotent. **Exit criteria:** every service is independently testable via curl/Postman.

### Phase 2 — Orchestrator (HTTP-based first)
Build the orchestrator with persisted saga state, calling services directly over HTTP to keep the first version simple. **Exit criteria:** a full happy-path order completes and its state transitions are visible in `saga_instances`.

### Phase 3 — Compensation
Implement the reverse-order compensation flow and prove it by forcing an inventory failure. **Exit criteria:** a forced failure results in a refund and a `FAILED` saga status, with no orphaned charges.

### Phase 4 — Event-Driven Migration
Replace direct HTTP calls with RabbitMQ publish/subscribe. Introduce idempotent consumers. **Exit criteria:** no direct service-to-service HTTP calls remain in the saga flow.

### Phase 5 — Observability & Recovery
Add the recovery worker, structured logging, and a simple status endpoint/dashboard. **Exit criteria:** killing the orchestrator mid-saga and restarting it results in the saga completing correctly.

---

## 10. Local Development Setup

Part 1 is implemented in the `@saga/shared` workspace: validated order/command/result contracts, idempotency helpers, and local provider simulations. See [contracts and business rules](docs/PART_1_CONTRACTS.md). Run `npm run check` for type checking, builds, and contract/provider tests. Payment endpoints are implemented in [Part 3](docs/PART_3_PAYMENT.md), and inventory reserve/release/finalize/status endpoints in [Part 4](docs/PART_4_INVENTORY.md). Shipping create/cancel/status endpoints are implemented in [Part 5](docs/PART_5_SHIPPING.md). Persisted HTTP orchestration is implemented in [Part 6](docs/PART_6_ORCHESTRATION.md); reverse-order compensation is implemented in [Part 7](docs/PART_7_COMPENSATION.md), with request-driven retries.

Run commands from the repository root (Node.js, npm, Docker, and Docker Compose required):

```bash
# Install dependencies for every service through npm workspaces
npm install

# Create local environment files
cp services/payment-service/.env.example services/payment-service/.env
cp services/inventory-service/.env.example services/inventory-service/.env
cp services/shipping-service/.env.example services/shipping-service/.env
cp services/order-orchestrator/.env.example services/order-orchestrator/.env

# Start four PostgreSQL instances and RabbitMQ
npm run infra:up

# Apply migrations and insert demo inventory
npm run migrate
npm run db:seed

# Start all four service development servers
npm run dev
```

The orchestrator listens on port **3000**, payment on **3001**, inventory on **3002**,
and shipping on **3003**. Each currently exposes `GET /health` as a liveness check;
it does not check database or broker connectivity. Payment, inventory, shipping, and forward HTTP orchestration are implemented.
See [Order checkout and resume](docs/PART_6_ORCHESTRATION.md),
[Payment examples](docs/PART_3_PAYMENT.md),
[Inventory examples](docs/PART_4_INVENTORY.md), and [Shipping examples](docs/PART_5_SHIPPING.md).

RabbitMQ management is available at `http://localhost:15672` with local development
credentials `saga` / `saga`. PostgreSQL ports are **5433–5436**, mapped to payment,
inventory, shipping, and orchestrator respectively. Connection URLs are provided
in each service's `.env.example`.

```bash
# Run a single service
npm run dev --workspace payment-service

# Check types and build all services
npm run typecheck
npm run build

# Run a compiled service
npm start --workspace payment-service

# After changing that service's src/db/schema.ts:
npm run db:generate --workspace payment-service
npm run migrate --workspace payment-service

# Stop infrastructure while preserving data volumes
npm run infra:down
```

Drizzle schemas and initial migrations are included for each service. Run
`npm run check:all` to verify types, builds, contract tests, and database integration tests.

---

## 11. Testing Strategy

- **Unit tests** — compensating-action logic, state machine transitions
- **Integration tests** — each service's endpoints against a real local Postgres
- **Saga-level tests** — simulate a forced failure at each step (payment fails, inventory fails, shipping fails) and assert the correct compensations ran
- **Idempotency tests** — send the same request twice with the same idempotency key and assert only one side effect occurred
- **Crash-recovery test** — kill the orchestrator mid-saga, restart it, assert the saga resumes and completes

---

## 12. Interview / Design-Review Talking Points

Be ready to explain, precisely:

1. How do you guarantee an organization's/order's charge isn't applied twice? *(idempotency key + unique constraint + insert-first)*
2. What happens if the orchestrator crashes between two steps? *(persisted state + recovery worker resumes from `current_step`)*
3. Why orchestration instead of choreography here? *(centralized visibility and easier compensation logic for a 3+ step flow)*
4. How is a compensating action different from a database rollback? *(it's a new, idempotent forward operation — not guaranteed to be a perfect physical undo)*
5. How do you prevent overselling stock during reservation? *(atomic reservations with ordered product locks; explicit release/finalization, with automatic expiry disabled until coordinated recovery)*