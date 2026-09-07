# Part 10 — System validation and runbook

All ten implementation parts are now represented by repeatable checks. The system
uses HTTP for order submission/status, RabbitMQ for saga commands/results, separate
PostgreSQL databases, durable outboxes/inboxes, reverse compensation, and recovery.
Payment and shipping providers remain local durable simulations.

## Start from a fresh checkout

Prerequisites: Node.js compatible with the installed dependencies, npm, Docker with
Compose, and permission to access Docker. This project has been exercised with Node
26 and npm 11. Use `npm ci` to reproduce the committed dependency versions.

From the repository root:

```bash
npm ci
# Copy each example only if its local .env does not already exist.
for service in payment-service inventory-service shipping-service order-orchestrator; do
  test -f "services/$service/.env" || cp "services/$service/.env.example" "services/$service/.env"
done
npm run infra:up
npm run migrate
npm run db:seed
npm run dev
```

The seed inserts missing demo products without replenishing stock already consumed.
Migrations can be rerun. Generate a new migration only after intentionally changing a
schema; generated SQL and metadata belong in version control.

| Service | HTTP | Database host port |
| --- | --- | --- |
| Orders | 3000 | 5436 |
| Payment | 3001 | 5433 |
| Inventory | 3002 | 5434 |
| Shipping | 3003 | 5435 |

RabbitMQ uses 5672; its management UI uses 15672. Local development credentials are
`saga` / `saga`. All services must use the same RabbitMQ URL and prefix. Environment
examples define the defaults. Recovery deadline/interval settings are described in
[Part 9](PART_9_RECOVERY.md).

Check readiness, then submit an order:

```bash
curl -i http://localhost:3000/ready
curl -i http://localhost:3001/ready
curl -i http://localhost:3002/ready
curl -i http://localhost:3003/ready
curl -i http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  --data-binary @examples/orders/create.json
```

Use the returned order ID for the following commands:

```bash
curl http://localhost:3000/orders/<orderId>
curl http://localhost:3000/orders/<orderId>/history
curl http://localhost:3000/orders/attention
curl -X POST http://localhost:3000/orders/<orderId>/resume
```

New work normally returns 202; poll GET for COMPLETED or FAILED. Repeating the same
customer/key/payload resumes the same order. Change the idempotency key for a new
checkout. A changed payload with an existing customer/key returns 409. Terminal failed
POST/resume returns 422. FAILED means required compensation is finished, not that an
uncertain operation was assumed unsuccessful.

For controlled business failures, set PAYMENT_SIMULATION_MODE or
SHIPPING_SIMULATION_MODE to `reject` or `timeout-after-success` and restart that
service. Restore `success` afterward. A fresh request containing the seeded monitor
product (`66666666-6666-4666-8666-666666666666`, stock zero) can exercise inventory
rejection; confirm the actual seed IDs in [the seed source](../services/inventory-service/src/db/seed.ts).
Use fresh order keys because prior provider results are durable. A ready-made
inventory-failure request is included:

```bash
curl -i http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  --data-binary @examples/orders/fail-inventory.json
```

Its final status should be FAILED with PAYMENT in `compensatedSteps`, assuming the
monitor still has zero stock and the payment simulation is set to success.

## Run the checks

```bash
npm run check:all
# Focused checks:
npm run test:system
npm run test:recovery
npm run test:messaging
```

`check:all` includes every workspace build/type check and all shared, database,
participant, HTTP saga, messaging, recovery, and system suites. Tests require the
four development PostgreSQL instances and CREATEDB privileges. Existing messaging
and recovery suites use the development RabbitMQ with isolated queue prefixes.

The system suite additionally starts its own `rabbitmq:4-management` container on a
dynamic loopback port, creates temporary databases, and launches service subprocesses
on temporary HTTP ports. It stops/restarts only its own broker and kills only its own
service children. Cleanup removes those children, databases, and the test container
with its anonymous volumes. No development broker stop or database reset is required.
Allow extra time for the first Docker image download if the image is unavailable.

## Requirement-to-test coverage

| Requirement | Evidence |
| --- | --- |
| Successful orders and each business failure | System suite launches production entrypoints; checks COMPLETED, payment decline, insufficient stock refund, shipping failure release/refund |
| Duplicate requests and stock contention | System suite submits concurrent HTTP duplicates and distinct orders against limited stock; verifies one order per key and refunds for rejected orders |
| Failed refunds and releases | System suite rejects refund/release database commits and verifies pending compensation and eventual cleanup; participant and HTTP suites cover additional cleanup failures |
| Crashes around commits/acknowledgements | System suite uses SIGKILL before an inventory transaction commits, after it commits before message acknowledgement, and after the orchestrator commits a result before acknowledgement |
| Publish confirmation/commit gap | Messaging suite injects outbox-update failure after publisher confirmation and verifies harmless republishing |
| Broker outage and restart | System suite shuts down its isolated broker, accepts durable work, restarts services/broker, and verifies queued-command persistence and completion |
| Redelivery and recovery | Messaging/recovery suites cover duplicates, stale results, lost responses, leases, deadlines, retries, DLQs and intervention |
| Readiness, history and logs | Production readiness is checked by the system suite; recovery suite validates dependency health, readable history and log redaction |

Fault boundaries are implemented only in `tests/system/fault-service.mjs`; there are
no production fault-injection endpoints or environment switches. Existing source
transaction callbacks let tests pause before commit, and consumer wrappers pause
before acknowledgement. Restart uses ordinary production entrypoints.

## Troubleshooting

| Symptom | Check and action |
| --- | --- |
| EADDRINUSE | Stop the previous service/dev process or configure a different PORT; do not start two instances on the same port |
| `/ready` is 503 | Inspect its dependency booleans, `docker compose ps`, and structured service logs; `/health` checks only liveness |
| Missing tables/columns | Run `npm run migrate` against the configured databases before restarting services |
| Order remains IN_PROGRESS | Check history, deadline, pending message ID, outbox publication and broker queues; allow automatic recovery to reconcile uncertain results |
| Order remains COMPENSATING | Cleanup is not confirmed yet; inspect failed operation and dependency state rather than treating it as FAILED |
| `requiresManualIntervention` is true | Inspect the reason/history and `/orders/attention`; fix the cause, then POST/resume. Inconsistent stored progress requires repair, not blind retry |
| RabbitMQ connection/authentication errors | Check URL credentials, port and common prefix; wait for broker readiness after startup |
| Unexpected repeated old result | Reused keys intentionally replay durable outcomes; use a new checkout key for a new order |
| Test Docker permission failure | Ensure the current user can access the Docker daemon; system tests need it to manage their isolated broker |
| Test database creation denied | Use a local test database role with CREATEDB and TEST_*_DATABASE_URL overrides as documented in earlier suites |

`npm run infra:down` stops infrastructure while preserving development volumes. Do
not delete business records, inboxes, or queues to retry a saga. Repair the underlying
cause and use the supported resume flow.

## Practical limits

Passing this suite is evidence for the tested local system, not a guarantee of zero
bugs or production readiness. It does not establish multi-node broker failover,
real payment/carrier behavior, production capacity, authentication/authorization,
backup restoration, or indefinite message-retention policies. Crash tests target
specific durable boundaries; they do not enumerate every possible instruction-level
crash or network partition. Those deployment requirements need separate validation.

## Verification result

On 2026-09-07, `npm run check:all` completed successfully with no failures or skips:
all workspace builds/type checks, shared contracts (26 reported tests), database
invariants (18), Payment (18), Inventory (16), Shipping (20), HTTP orchestration (31),
RabbitMQ messaging (18), recovery (15), and system validation (11). Integration
counts include parent tests; system validation contains 10 individual scenarios.

The schema generator found no outstanding changes in any service, both order
examples validated against the shared contract, and `git diff --check` passed.
System-test child processes, temporary databases, and the isolated broker were
cleaned up by the suite. No development server was left running by this work.
