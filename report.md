# Project review

Reviewed on **2026-09-07**, against commit **`cf35d73`** (`feat: add Postman collection generation script for Saga Order System`).

The project is a working local demonstration of an event-driven saga, with substantial integration and failure-recovery coverage. The existing checks passed during this review. Three additional probes nevertheless confirmed an availability defect and two problems in the manual-intervention API. Those should be addressed before extending the system or relying on it operationally.

This review changes only this report. Application code, configuration, and committed tests were not modified.

## Scope and verification

Reviewed the four service implementations, shared contracts, database schemas and migrations, RabbitMQ workers, outbox/inbox handling, compensation and recovery logic, HTTP endpoints, test suites, development configuration, implementation plan, documentation, and Postman generator/artifacts.

| Check executed during this review | Result |
| --- | --- |
| `npm run check` | Workspace type checks and builds passed; 26 shared tests passed |
| All eight integration/system test files against the freshly built code | 147 reported tests passed; zero failures, cancellations, or skips |
| Targeted idle PostgreSQL connection termination | Confirmed an unhandled pool error and child-process exit code 1 |
| Targeted compensation intervention scenario | Confirmed the attention API reports the wrong operation |
| Targeted backlog of 101 flagged orders | Confirmed the oldest flagged order is omitted with no pagination mechanism |

**Total existing-suite result: 173 reported tests passed.** Node's totals include parent tests; this is not a claim of 173 independent business scenarios. The three review probes reproduced defects rather than validating fixes.

The integration suites were run directly after `npm run check` to avoid repeating the same build before every suite:

```bash
node --test --test-isolation=none --test-reporter=spec \
  tests/database/*.test.mjs tests/payment/*.test.mjs \
  tests/inventory/*.test.mjs tests/shipping/*.test.mjs \
  tests/orchestrator/*.test.mjs tests/messaging/*.test.mjs \
  tests/recovery/*.test.mjs tests/system/*.test.mjs
```

Initial sandbox attempts could not access localhost databases or Docker; the checks above completed successfully after rerunning with the required access. These permission failures were not application defects. Tests and probes used temporary databases, isolated broker resources, and disposable processes; their cleanup completed. The connection-termination probe targeted only its own test connection.

Newman was not rerun in this review. The Postman guide's earlier 397-assertion result is historical evidence, separate from the results above. No dependency vulnerability audit, load benchmark, real-provider validation, or multi-node failover exercise was performed.

## Findings, ordered by priority

### R1 — High: idle database connection errors can terminate a service

**Evidence:** All four `createDatabase()` implementations construct a `pg.Pool` without an `error` listener: [payment](services/payment-service/src/db/client.ts), [inventory](services/inventory-service/src/db/client.ts), [shipping](services/shipping-service/src/db/client.ts), and [orders](services/order-orchestrator/src/db/client.ts), lines 6–8. Their production entrypoints do not add one. Payment and shipping also construct provider pools through the same factories.

An idle PostgreSQL client's connection error is forwarded as a pool `error` event by the installed `pg-pool` implementation. This asynchronous event occurs outside the HTTP handler's `try/catch` and outside the RabbitMQ worker's error handling. Without a listener, it becomes an unhandled error and terminates the Node process.

**Reproduction performed:** A disposable child imported the actual compiled order-service database factory, executed `SELECT pg_backend_pid()`, and returned the connection to its pool. A separate connection terminated only that backend using `pg_terminate_backend`. The pool had zero error listeners. The child exited with code **1**, reporting **`Unhandled 'error' event`**. The other three services share the same relevant factory code; their processes were not separately fault-injected.

**Impact:** A database restart or loss of an idle connection can take the HTTP service and its workers down instead of allowing dependency readiness to degrade and connections to recover. Durable records survive, but processing requires the process to be restarted. The current system tests exercise broker and service crashes, which do not cover this database-disconnection path.

**Recommended fix:** Register a safe pool error handler for every application and provider pool. Log a sanitized error category, allow replacement connections to be created, and preserve accurate readiness reporting. If an error is considered fatal, use an explicit shutdown policy with a configured supervisor rather than an accidental unhandled event.

**Required regression check:** Warm an idle connection in each production service, terminate that test backend, and verify the process remains alive and subsequently serves requests after reconnection. Include provider pools and a database restart scenario.

### R2 — Medium: the attention API identifies the wrong operation during compensation

**Evidence:** [OrderService.attention()](services/order-orchestrator/src/orders/service.ts), lines 144–147, returns `sagaInstances.currentOperation` as `operation`. However, [nextCompensation()](services/order-orchestrator/src/saga/compensate.ts) deliberately preserves the failed forward operation and derives the compensation operation separately.

**Reproduction performed:** Advanced an order through successful payment and reservation, supplied a shipping rejection, and returned three unresolved results for `RELEASE_INVENTORY`. The saga correctly remained `COMPENSATING` and required intervention. Its last result identified `RELEASE_INVENTORY`, but the attention entry was:

```json
{
  "status": "COMPENSATING",
  "operation": "CREATE_SHIPMENT",
  "reason": "COMMAND_RETRIES_EXHAUSTED"
}
```

**Impact:** An operator sees shipment creation as the operation requiring attention when inventory release is actually blocked. The same ambiguity applies to a stalled refund. This can direct investigation and repair toward the wrong service; it does not itself change compensation order or corrupt stock.

**Recommended fix:** Return an explicit pending compensation operation, derived from the compensation cursor or correlated command. If the original failed operation is useful, expose it separately as `failedForwardOperation`. Handle inconsistent stored progress without making the whole attention list fail.

**Required regression check:** Exhaust release retries and refund retries separately, and assert that `/orders/attention` identifies `RELEASE_INVENTORY` and `REFUND_PAYMENT` respectively. Also check forward failures and inconsistent-progress cases.

### R3 — Medium: older intervention cases cannot be discovered through the API after 100 accumulate

**Evidence:** [OrderService.attention()](services/order-orchestrator/src/orders/service.ts), line 147, sorts by newest update and applies a fixed `limit(100)`. [The HTTP route](services/order-orchestrator/src/app.ts), line 33, accepts no cursor or page and returns no continuation information. There is no separate general order-list endpoint.

**Reproduction performed:** Created 101 flagged sagas in a temporary database. The attention query returned exactly 100 entries and omitted the oldest compensating saga. Repeating the request exposes the same bounded selection while those records remain unchanged.

**Impact:** A larger incident can hide older unresolved orders from an operator who does not already know their IDs or have database access. Resolving newer entries eventually exposes older ones, but continuous arrivals can keep older cases outside the visible list.

**Recommended fix:** Keep a bounded page size, add cursor pagination with a stable ordering such as `(updatedAt, orderId)`, and return a continuation cursor. Consider an oldest-first option for incident triage.

**Required regression check:** Create at least 101 flagged orders, traverse every page, and verify every ID appears exactly once, including when timestamps are equal. Define and test the behavior when records change during pagination.

### R4 — Low: introductory documentation still describes an earlier implementation

**Evidence:** [README.md](README.md), section 4, draws shipping success directly to `COMPLETED`; the actual [broker state machine](services/order-orchestrator/src/saga/brokerOrders.ts) requires a successful `FINALIZE_INVENTORY` result first. Section 8 says business handlers will be implemented in subsequent parts and lists tables without the later messaging/provider additions, despite the opening statement that all ten parts are implemented.

**Impact:** Readers can misunderstand the completion boundary and current schema, especially when an order has a shipment but is still waiting for finalization. The more detailed Part 10 runbook is substantially clearer.

**Recommended fix:** Show inventory finalization explicitly, update the table overview, and label historical roadmap material as historical. Ensure the diagram distinguishes an immediate payment decline from a failure requiring compensation.

## What is implemented well

| Area | Review assessment and evidence |
| --- | --- |
| Service ownership | Four services own separate PostgreSQL databases. Runtime orchestration uses RabbitMQ rather than direct cross-service database writes. |
| Atomic order acceptance | Order, items, saga, initial transition, and first command outbox entry are committed together through `OrderService.accept()` and `BrokerOrderService.onAccepted()`. |
| Reliable message handling | Outbox publication uses confirms and mandatory returns. Participants couple completed operations with inbox/result-outbox records, and acknowledge after processing. Existing messaging tests exercise republishing and deduplication. |
| Business idempotency | Persistent receipts, payload fingerprints, stable operation keys, and per-order serialization protect repeat requests and reject conflicting reuse. |
| Inventory integrity | Reservations lock product rows in a consistent order and change stock atomically. Database checks reject negative stock. Release and finalization have distinct, tested behavior. |
| Uncertain provider outcomes | Payment and shipping treat unknown outcomes as unresolved and retry/reconcile with stable keys. They do not blindly compensate a timed-out forward request. |
| Compensation | Cleanup runs in reverse order with separate progress tracking. Failed cleanup stays pending; a terminal `FAILED` is reached only after required cleanup is confirmed. |
| Recovery | Persisted deadlines, bounded retries, leases, stale-result handling, and intervention flags support restart recovery. Unpublished commands do not consume the response retry budget. |
| Diagnostics | Health/readiness separation, structured logs with an explicit field allowlist, and persisted transition history provide useful operational evidence. R2 and R3 identify shortcomings in the attention view. |
| Verification | The system suite checks independent processes, stock contention, failed cleanup commits, broker restarts, and crashes around durable boundaries. It passed in this review. |
| Manual testing | The Postman artifacts cover all implemented HTTP routes, with generated IDs, replay checks, validation failures, polling, and documented optional provider modes. |

## Deployment and product boundaries

These are limits of the current demonstration and deployment model, distinct from the reproduced defects above. Several are already acknowledged in [the Part 10 runbook](docs/PART_10_VALIDATION.md).

- **Access control and network exposure:** HTTP routes have no authentication or authorization, including participant mutations, order details, and resume operations. Entrypoints call `serve()` without a hostname, so their listeners are not explicitly restricted to loopback; Docker's loopback bindings protect the database/broker ports only. Before exposing this outside a trusted local environment, establish a restricted network boundary, authenticated customer identity, order ownership checks, and privileged operator/service access. An order UUID is not authorization.
- **Trusted checkout amount:** The caller supplies `customerId`, `amountMinor`, and `currency`. The product schema has no pricing data and the orchestrator performs no catalog price calculation. This is suitable for exercising the saga with trusted inputs. A customer-facing checkout needs an authoritative price/quote and customer identity before charging a real provider.
- **Simulated external effects:** Payment and shipping providers persist local simulations. No real card payment, carrier shipment, credential rotation, provider webhook flow, or external reconciliation contract has been validated.
- **Capacity and retention:** There is no implemented archival/retention policy for receipts, inboxes, outboxes, or transitions. Order status loads all transitions even when the caller only needs current status. At higher volume, measure latency and storage growth, separate status from paginated history, and design retention around the supported retry/idempotency window. Deleting receipts arbitrarily would weaken replay safety.
- **Delivery automation:** No CI workflow was found. The root package also does not declare a Node engine requirement, although documentation identifies the exercised Node/npm versions. Add automated checks and an explicit supported runtime to make verification reproducible for other contributors.
- **Deployment resilience:** Local single-node RabbitMQ and PostgreSQL containers do not establish high availability, backup restoration, or production capacity. Those need separate deployment work and fault testing.

## Recommended implementation order

1. Fix **R1** and add database-disconnection regression coverage. This directly affects whether services remain available during a dependency interruption.
2. Fix **R2** and **R3** together, with API tests for compensation operation labels and paginated intervention backlogs.
3. Update the README completion diagram and schema overview (**R4**).
4. Add CI and a documented/enforced runtime version, preserving the current isolation and cleanup behavior of integration tests.
5. If the goal expands to a customer-facing deployment, define authentication, pricing authority, real-provider contracts, retention, and infrastructure requirements before treating this as production-ready.

The passing suite demonstrates that the implemented saga flows work under the tested conditions. The additional reproduced findings show where its current coverage and operational behavior need improvement.
