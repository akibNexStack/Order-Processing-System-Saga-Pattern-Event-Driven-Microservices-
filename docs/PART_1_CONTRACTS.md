# Part 1 — Contracts and business rules

## Scope and imports

`@saga/shared` exports version 1 Zod schemas, inferred TypeScript types, saga vocabulary,
idempotency helpers, and payment/shipping provider interfaces. All four services depend
on this workspace package. Simulated implementations are available separately from
`@saga/shared/testing` and must be explicitly injected in local development or tests.
They are not connected to HTTP routes yet.

Run `npm run check` from the root to build, check types, and execute the contract and
provider tests. Root builds compile shared code before services; `npm run dev` also
builds shared code first. After changing shared sources during development, run
`npm run build --workspace @saga/shared` again. Do this before running an individual
service from a fresh checkout as well.

## Order input

```json
{
  "idempotencyKey": "checkout:example-1",
  "payload": {
    "customerId": "33333333-3333-4333-8333-333333333333",
    "items": [
      { "productId": "44444444-4444-4444-8444-444444444444", "quantity": 2 }
    ],
    "amountMinor": 12500,
    "currency": "BDT",
    "shippingAddress": {
      "recipient": "Test Customer",
      "line1": "10 Test Road",
      "city": "Dhaka",
      "postalCode": "1207",
      "countryCode": "BD"
    }
  }
}
```

- Customer, product, order, and saga identifiers are UUIDs. The orchestrator will assign
  order and saga IDs; clients provide the customer ID and checkout idempotency key.
- Amounts use positive integer minor units: `12500` means `125.00`. Initially only USD
  and BDT are supported, both with two decimal places. Maximum: `9_999_999_999` minor
  units, matching the README's proposed `DECIMAL(10,2)` range. Database mapping must use
  exact decimal strings or integer storage, not floating-point arithmetic.
- The amount is a quoted total in this demo. Schema validation does not authenticate
  customers or establish trusted prices. A real checkout must calculate or verify the
  total from trusted pricing before charging. Taxes, delivery fees, and partial refunds
  are outside this first contract.
- An order has 1–100 distinct products, each with integer quantity 1–10,000. Duplicate
  product IDs are rejected, including differences in UUID letter case.
- Address text is trimmed and must be nonblank; region and line2 are optional.
  Country codes must be two uppercase letters; this is format validation, not an
  address verification service or an exhaustive ISO country lookup.
- Unknown fields, including client-supplied simulation switches, are rejected.

## Commands and results

Every command has `version: 1`, `orderId`, `sagaId`, `idempotencyKey`, `operation`, and
an operation-specific `payload`. Results echo the metadata without the payload.
These contracts can be carried over HTTP initially and RabbitMQ later.

| Operation | Payload | Successful result data |
| --- | --- | --- |
| CHARGE_PAYMENT | customerId, amountMinor, currency | CHARGED, providerTransactionId |
| REFUND_PAYMENT | empty object | REFUNDED or NOOP |
| RESERVE_INVENTORY | items | RESERVED, reservationId |
| RELEASE_INVENTORY | empty object | RELEASED or NOOP |
| CREATE_SHIPMENT | items, shippingAddress | CREATED, providerShipmentId |
| CANCEL_SHIPMENT | empty object | CANCELLED or NOOP |

Compensations reference the original operation by order ID and reverse it in full.
Services must verify saga ownership and use their stored original data. A refund
request cannot supply a replacement amount. Compensation with nothing to undo is a
successful no-op. A persisted cancellation marker must prevent delayed forward work
from recreating a compensated effect; the simulators demonstrate this rule.

Results have three outcomes:

- `SUCCEEDED`: operation-specific validated data.
- `FAILED`: a confirmed rejection, with a code, message, and `retryable: false`.
- `UNKNOWN`: timeout/unavailability, with a code, message, and `retryable: true`.
  Retry with the same key or reconcile with the provider; never assume no side effect.

Consumers must check correlation IDs and the expected operation before advancing a
saga. A valid result schema alone does not establish that a result belongs to the
currently pending step. Invalid input is a boundary validation error, not a fabricated
business result. Expected HTTP mapping later: invalid input 400, conflicting key 409.

## Saga vocabulary

Forward order: PAYMENT → INVENTORY → SHIPPING.

Statuses: IN_PROGRESS, COMPENSATING, COMPLETED, FAILED. `FAILED` is terminal only when
required compensation has succeeded. A first-step rejection can fail directly when
there are no effects to undo. Successful steps compensate in reverse order:
SHIPPING → CANCEL_SHIPMENT, INVENTORY → RELEASE_INVENTORY, PAYMENT → REFUND_PAYMENT.

The transition engine, durable progress, retry scheduling, and result correlation are
future implementation parts. Inventory finalization/expiry and shipment cancellation
eligibility must be resolved in their service implementations before expiring stock
or integrating irreversible fulfillment. Do not auto-expire reservations yet.

## Idempotency rules

- Checkout keys are scoped to the customer. Command keys are scoped to the receiving
  service. Enforce uniqueness in each service database when persistence is implemented.
- Keys contain 1–255 ASCII letters, digits, colons, underscores, or hyphens.
- `commandKey(sagaId, operation)` generates `saga:<uuid>:<operation>`. Retries use the
  same key; forward and compensation operations always use different keys.
- Validate input before computing its fingerprint. `commandFingerprint` hashes the
  version, operation, IDs, and payload with sorted object keys. It excludes the
  idempotency key. Array order remains significant, so retain the original item order
  when retrying. Apart from validation's address trimming, values are not normalized.
- Same key and fingerprint returns the saved result; a changed fingerprint is a
  conflict. Also enforce one forward business effect per order to guard against a
  caller changing keys. A replay returns the original historical result even after
  compensation; it is not a current-status query and must not reapply the effect.
- Future services must atomically persist deduplication and database effects. Provider
  calls require a stable provider key and reconciliation across crashes; an in-memory
  map is not a substitute. Retain records through the supported retry/recovery window.

## Simulated providers

`SimulatedPaymentProvider` implements `charge`/`refund`; `SimulatedShippingProvider`
implements `create`/`cancel`. Each constructor accepts:

- `success` (default): forward action succeeds with a deterministic simulated ID.
- `reject`: forward action fails; compensation is a no-op.
- `timeout-after-success`: first forward request applies the effect but returns UNKNOWN;
  retrying the same key returns the recorded success.

Each instance keeps isolated in-memory state. Repeated and concurrent calls are
idempotent within that instance; state resets when it is recreated. Compensation
creates a marker that blocks new forward work for that order. Returned values are
copied so callers cannot mutate the stored response. These simulators make no external
calls, move no money, and create no real shipments. They do not prove database-level
idempotency, multi-process safety, or crash recovery.

Schema API reference: [Zod documentation](https://zod.dev/api).
