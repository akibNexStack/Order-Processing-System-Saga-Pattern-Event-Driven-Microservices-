# Part 5 — Shipping Service

## Start and try the endpoints

From the repository root with service `.env` files configured:

```bash
npm run infra:up
npm run build --workspace @saga/shared
npm run migrate --workspace shipping-service
npm run dev --workspace shipping-service
```

In a second terminal at the repository root:

```bash
curl -i http://localhost:3003/shipments/create \
  -H 'Content-Type: application/json' \
  --data-binary @examples/shipping/create.json

curl http://localhost:3003/shipments/11111111-1111-4111-8111-111111111111

curl -i http://localhost:3003/shipments/cancel \
  -H 'Content-Type: application/json' \
  --data-binary @examples/shipping/cancel.json
```

Repeat the POST commands unchanged to verify saved responses. Use a new order/saga
and new keys for a new shipment after cancellation. A new key alone cannot recreate
a cancelled order. The example IDs match the payment and inventory samples, but
these are still independently callable services, not an implemented saga.

## HTTP contract

| Endpoint | Behavior |
| --- | --- |
| GET /health | Process liveness |
| POST /shipments/create | Validated CREATE_SHIPMENT command |
| POST /shipments/cancel | Validated CANCEL_SHIPMENT command |
| GET /shipments/:orderId | Current shipment and cancellation, including cancellation-only markers |

POST bodies use the complete Part 1 command envelope. Create payloads have items and
a shipping address; cancellation payloads are empty. UUIDs normalize to lowercase,
items sort by product ID, and address strings are trimmed before fingerprinting.
Reordered items and object properties are equivalent. Changes to quantities, products,
address, or saga ownership conflict with an existing order.

| HTTP status | Meaning |
| --- | --- |
| 200 | SUCCEEDED, including saved replay and cancellation NOOP |
| 202 | UNKNOWN: order busy, provider timeout/unavailable, malformed or mismatched response |
| 400 | Invalid JSON, command, or order UUID |
| 404 | No shipment/cancellation for the requested order |
| 409 | Idempotency/ownership conflict, already compensated, or provider cancellation rejection |
| 413 | Body exceeds 32 KiB |
| 415 | Unsupported or missing Content-Type |
| 422 | Confirmed shipping rejection |
| 503 | Service/database error; does not establish whether a provider effect happened |

202 and 503 return `Retry-After: 1`. Retry the original key. Successful command replay
returns its historical result; GET provides current state. Do not infer that a
cancelled shipment was recreated just because an old CREATE command replays CREATED.

## Cancellation eligibility

A shipment in this demo is a **booking before physical dispatch**. The state policy is:

| Shipment state | Cancellation behavior |
| --- | --- |
| Missing | Persist cancellation marker, return NOOP, block delayed creation |
| PENDING | Reconcile creation with the same provider key first; remain pending if unresolved |
| CREATED | Request provider cancellation; on success mark CANCELLED |
| FAILED | Persist successful cancellation NOOP; nothing was booked |
| CANCELLED | Replay completed cancellation without another effect |

A provider rejection leaves cancellation pending and the shipment unchanged. The
orchestrator must not mark compensation complete; investigate the cause, then retry
the original key when appropriate. A permanently ineligible real-world shipment
would require manual handling or a separate return workflow.

There are no DISPATCHED/DELIVERED states or dispatch endpoints in this part. A future
carrier adapter must define these irreversible transitions and reject cancellation
when no longer supported; it cannot assume every physical shipment is cancellable.
These internal development endpoints check persisted ownership, not authenticated
identity, and do not independently verify payment or stock reservation. The future
orchestrator must enforce the business sequence.

## Persistence and retry behavior

- The database stores a command receipt before provider work, with an insert-first
  unique key and fingerprint. A changed command cannot reuse the key.
- A PENDING shipment/cancellation is committed before the provider call. Requests for
  one order serialize under a PostgreSQL session advisory lock; competing requests
  get UNKNOWN/202 rather than starting overlapping operations.
- The provider receives `commandKey(sagaId, operation)`, independent of the client key.
  Multiple matching client keys still refer to a single provider operation.
- Provider results are schema-validated and checked against the expected operation,
  order, saga, and key. Exceptions, wrong correlation, and deadlines remain UNKNOWN.
- A confirmed create result is persisted on the shipment before completing its receipt.
  A retry resumes from that result if the process stops between these writes. If the
  provider succeeds but the local write fails, a retry reconciles through its stable key.
- Cancellation of a pending create resolves that create before attempting cancellation.
  Cancellation success updates the cancellation row, shipment status/time, and command
  receipt in a single local transaction. Failure does not mark compensation complete.
- Persistent cancellation markers prevent late new CREATE requests. A timed-out provider
  call can still finish; provider idempotency and cancellation ordering must prevent
  it from recreating a cancelled booking. The local provider enforces this.
- The provider and service use separate pools, avoiding connection starvation while
  service requests hold advisory locks. Locks are released in finally; failed unlocks
  cause the connection to be discarded. Normal server shutdown closes both pools.

The new shipping migration adds `shipments.create_result` and local-only simulator
tables `simulated_provider_shipments` and `simulated_provider_requests`. Provider state
survives recreation of the service/provider objects and is committed separately from
application records. No real carrier is called and no physical shipment is created.
Any production adapter needs equivalent stable-key and reconciliation guarantees.

Recovery is request-driven in Part 5. Automatic background retries and complete
process-kill saga recovery remain later parts. Existing legacy/manual records without
matching provider history require reconciliation before using a real carrier.

## Controlled provider failures

Set `SHIPPING_SIMULATION_MODE` in `services/shipping-service/.env` or when starting:

```bash
SHIPPING_SIMULATION_MODE=reject npm run dev --workspace shipping-service
SHIPPING_SIMULATION_MODE=timeout-after-success npm run dev --workspace shipping-service
```

- `success` (default): booking and cancellation succeed.
- `reject`: new booking operations return SHIPPING_REJECTED.
- `timeout-after-success`: the first successful create/cancel commits at the simulated
  provider but returns UNKNOWN. A retry reads its saved success.

Use fresh order/saga IDs for each scenario; existing provider results do not change
when the mode changes. Clients cannot enable failure injection in request payloads.
`SHIPPING_PROVIDER_TIMEOUT_MS` defaults to 5000, with a supported range of 1–60000.

## Verification

```bash
npm run test:shipping
npm run check:all
```

Shipping tests create and remove their own temporary PostgreSQL database. They use
`TEST_SHIPPING_DATABASE_URL` or the shipping service `.env` connection to locate an
existing administrative database; the user needs CREATEDB privileges. Development
tables are not cleared. A real HTTP smoke test uses an ephemeral port and closes it.

Checks cover validation, create/status/cancel, duplicate and concurrent commands,
changed address/items/ownership, stable provider keys, no-op cancellation markers,
rejections, uncertain creation, lost create/cancel responses, service/provider
recreation, provider exceptions/deadlines/wrong correlation, database failures after
provider success, cancellation rejection and rollback, normalized inputs, late
responses, and creation/cancellation races.

These tests verify the implemented booking workflow and its failure boundaries;
they do not establish that future carrier integrations or the unimplemented saga
are correct.
