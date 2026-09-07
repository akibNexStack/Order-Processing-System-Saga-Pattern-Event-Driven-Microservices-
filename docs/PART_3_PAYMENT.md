# Part 3 — Payment Service

## Start and exercise the service

Run from the repository root with service `.env` files configured:

```bash
npm run infra:up
npm run build --workspace @saga/shared
npm run migrate --workspace payment-service
npm run dev --workspace payment-service
```

In another terminal at the repository root:

```bash
# Charge BDT 125.00
curl -i http://localhost:3001/payments/charge \
  -H 'Content-Type: application/json' \
  --data-binary @examples/payment/charge.json

# Read current payment and refund state by order ID
curl http://localhost:3001/payments/11111111-1111-4111-8111-111111111111

# Refund the original charge in full
curl -i http://localhost:3001/payments/refund \
  -H 'Content-Type: application/json' \
  --data-binary @examples/payment/refund.json
```

Repeat either POST unchanged to verify idempotency. Successful command replays return
saved historical results; use GET for current state. After refunding the example,
use new order/saga IDs and keys for a new purchase. Changing only the key must not
create another charge for the same order. Refund payloads cannot specify an amount.

## HTTP contract

| Endpoint | Behavior |
| --- | --- |
| GET /health | Process liveness only |
| POST /payments/charge | Validated CHARGE_PAYMENT command |
| POST /payments/refund | Validated REFUND_PAYMENT command |
| GET /payments/:orderId | Current payment and refund, including refund-only no-op markers |

POST bodies use the complete Part 1 command envelope. UUIDs are normalized to lowercase
before fingerprinting; object property order does not change the fingerprint. Client
keys remain case-sensitive. JSON request bodies are limited to 32 KiB.

| HTTP status | Meaning |
| --- | --- |
| 200 | SUCCEEDED, including idempotent replay and refund NOOP |
| 202 | UNKNOWN: processing contention, provider deadline, unavailable/mismatched response; retry the same key |
| 400 | Invalid JSON, command, or order ID |
| 404 | No payment or refund for this order |
| 409 | Key/payload/ownership conflict, already compensated, or provider business rejection other than decline |
| 413 | Request body too large |
| 415 | Missing or unsupported Content-Type |
| 422 | Confirmed payment decline |
| 503 | Service/database error; response does not imply that no provider effect occurred |

202 and 503 include `Retry-After: 1`. Never generate a new key to recover from these
responses. A confirmed refund rejection leaves the refund pending; investigate the
provider's rejection, then retry the original command after the cause is resolved.
It is not reported as successful compensation or automatically retried here.

These are internal development endpoints with no authentication layer. Customer and
saga IDs are checked for consistency with existing records, not against a signed-in
identity. The current adapter only simulates payments; no real gateway is connected.

## Persistence and concurrency

1. Acquire a nonblocking PostgreSQL session advisory lock for the order. A competing
   operation gets UNKNOWN/202 and can retry. This serializes charge/refund processing
   across service instances without keeping a transaction open during provider calls.
2. Insert the command receipt first and let the database key enforce uniqueness. Check
   its fingerprint; replay completed results or resume PROCESSING receipts.
3. Check order/saga ownership and immutable charge details. Commit a PENDING payment
   or refund record before contacting the provider. Refund records block new forward
   commands, including after service restarts.
4. Call the provider using `commandKey(sagaId, operation)`, independent of the client
   request key. Validate the returned result and correlation metadata. A bounded
   provider deadline, thrown error, malformed response, or wrong correlation yields
   UNKNOWN and leaves work pending.
5. Persist a confirmed charge result on the payment, then complete its receipt. If
   execution stops between these writes, retry finishes from the saved charge result.
   If it stops after provider success but before the local write, retry uses the same
   provider key and reconciles the original action.
6. Refund reconciles a PENDING charge first. A declined/missing charge is a safe NOOP.
   A successful refund updates its row, the charged payment, and the completed receipt
   in one local transaction. Failed or uncertain refunds remain pending.
7. Release the session lock in a finally block. Destroy a connection if unlocking fails.
   PostgreSQL releases locks when a session ends. The service and local provider use
   separate connection pools so provider calls can obtain connections while service
   requests hold locks. Both pools close during normal server shutdown.

Advisory locks are cooperative: all payment writers must use this service. The database
uniqueness constraints remain a second guard. A timed-out provider call may continue;
provider-side idempotency and compensation ordering are still required. The local
provider implements both under its own per-order transaction lock. Any future external
adapter must supply equivalent guarantees, including late calls after compensation.

Recovery in Part 3 is request-driven: retry the original POST. Background scanning and
automatic retry scheduling remain Part 9. This part does not implement the order saga,
real gateway authentication, payment-method collection, or production fulfillment.

## Local durable provider and controlled failures

The service uses `LocalPaymentProvider`, which persists simulated provider effects and
responses separately in `simulated_provider_payments` and `simulated_provider_requests`.
They are local-only simulator tables introduced by the new payment migration. This
allows recreation of both the service and provider without forgetting earlier effects.
The Part 1 in-memory simulator remains available for isolated unit tests.

Set `PAYMENT_SIMULATION_MODE` in `services/payment-service/.env`, or supply it when
starting the payment service:

```bash
PAYMENT_SIMULATION_MODE=reject npm run dev --workspace payment-service
PAYMENT_SIMULATION_MODE=timeout-after-success npm run dev --workspace payment-service
```

- `success` (default): charge/refund succeeds.
- `reject`: new charge commands are declined; existing saved results remain unchanged.
- `timeout-after-success`: the first successful provider operation commits its effect
  but returns UNKNOWN; retry resolves it from the durable provider response. Applies
  to both charge and refund.

Use fresh IDs for each scenario. Simulation settings are server-controlled; request
payloads cannot enable them. `PAYMENT_PROVIDER_TIMEOUT_MS` defaults to 5000 (range
1–60000). These settings never trigger real charges or refunds.

## Verification

```bash
npm run test:payment  # PostgreSQL-backed payment tests, including real HTTP
npm run check:all     # Type/build, shared contracts, database and payment suites
```

Payment tests create a temporary database, migrate it, then remove it. They use
`TEST_PAYMENT_DATABASE_URL` or the payment service `.env` URL to locate PostgreSQL,
following Part 2's CREATEDB requirement. Tests cover validation, duplicates, concurrent
requests, ownership and payload conflicts, persistent no-op compensation, provider
declines, lost responses, recreated service/provider objects, provider exceptions and
deadlines, wrong correlation, late responses, injected database failures after provider
success, refund failures, exact maximum amounts, and charge/refund races. The HTTP
smoke test binds an ephemeral port and closes its server afterward.

Recreated objects and injected failures verify recovery boundaries; a complete
multi-service process-kill recovery test belongs to the later saga/recovery parts.

References: [Hono request testing](https://hono.dev/docs/api/hono#request)
and [PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).
