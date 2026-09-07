# Part 7 — Durable HTTP compensation

> The running services now use [Part 8 RabbitMQ transport](PART_8_MESSAGING.md).
> This document describes the earlier HTTP implementation retained for regression tests.


Confirmed inventory rejection automatically refunds the successful payment. Confirmed
shipping rejection automatically releases inventory, then refunds payment. The same
request attempts cleanup; `FAILED` is saved only after every required undo is confirmed.
A first-step payment decline also returns `FAILED`, because nothing needs undoing.

## Requirements and verification

| Requirement | Implementation and integration checks |
| --- | --- |
| Separate compensation progress | `completedSteps` preserves forward success; `compensatedSteps` records confirmed cleanup in reverse order. History entries use `direction: COMPENSATION` and the step being undone. |
| Reverse order | Shipping rejection dispatches RELEASE_INVENTORY then REFUND_PAYMENT. A failed release stops execution before refund. Tests assert calls, stock, payment status, and history. |
| Refund on inventory rejection | Insufficient stock triggers REFUND_PAYMENT, produces a REFUNDED payment and a FAILED saga, and never creates a shipment. |
| Retry failed cleanup | FAILED, UNKNOWN, exceptions, or invalid/mismatched results leave COMPENSATING with retry metadata. Resume uses the same command key and skips already confirmed cleanup. |
| Reconcile uncertain forward outcomes | Replay the pending forward command with its stable key before choosing compensation. A timeout never means business rejection. Tests cover lost payment, inventory, and shipping responses. |
| Durable cleanup and terminal state | Progress and history commit atomically with a version check. Tests fail history writes after remote cleanup and at terminal completion, then resume without duplicate effects. |
| Concurrency and idempotency | One session advisory lock spans forward execution and cleanup. Concurrent resumes across instances produce one cleanup sequence; participant receipts prevent duplicate effects after response loss. |
| Protect finalization | Uncertain or rejected inventory finalization remains IN_PROGRESS for reconciliation. Inconsistent reverse progress and attempts to compensate at finalization are rejected before dispatch. |

## State and retry policy

`currentOperation` and `currentStep` preserve the rejected forward operation. The next
cleanup command is derived from the reverse of `completedSteps`, minus the confirmed
prefix in `compensatedSteps`. This uses the existing schema and needs no new migration.
It also supports unfinished COMPENSATING sagas created by Part 6.

Every cleanup attempt records COMPENSATION_DISPATCHED before the HTTP call. A confirmed
success records COMPENSATION_SUCCEEDED. Any failure records
COMPENSATION_RETRY_REQUIRED, retains COMPENSATING, and sets `nextAttemptAt` one second
later. Once the reverse list is exhausted, COMPENSATION_COMPLETED saves FAILED.
`lastResult` describes the most recent command; the original business rejection remains
in the STEP_REJECTED history entry.

Participant success may be a confirmed no-op when there is nothing left to undo.
A participant FAILED result is never treated as successful cleanup, even when its
error says `retryable: false`. Such a business conflict can require investigation;
repeated resumes cannot guarantee that a permanent conflict will resolve.

Recovery is **request-driven** in this part. Repeat the original POST `/orders` with
the same customer/key/payload, or call:

```bash
curl -X POST http://localhost:3000/orders/<orderId>/resume
curl http://localhost:3000/orders/<orderId>
```

Replace `<orderId>` with the returned ID. GET is read-only. Pending work returns HTTP
202 with `Retry-After: 1` on POST/resume; terminal FAILED returns 422. Status includes
`requiresCompensation: true` while cleanup remains pending. A completed failed-order
replay makes no further participant calls. Explicit resume may run immediately;
scheduled background retries and stale-saga recovery belong to Part 9.

A successful shipment leads directly to inventory finalization. There is no later
reversible business step or order-cancellation API in this checkout flow, so shipping
rejection requires only release and refund. The Shipping Service cancellation endpoint
remains available, but uncertain shipment creation is reconciled by replaying creation,
and finalization is never used as a reason to cancel a successful shipment.

## Run checks

Start infrastructure as described in the README, then run:

```bash
npm run test:orchestrator
npm run check:all
```

The orchestration tests use temporary databases and actual participant HTTP servers,
including durable simulated payment/shipping providers. They clean up their own test
databases and servers. The full check also validates all previously implemented parts.
RabbitMQ transport remains Part 8; background recovery remains Part 9.

Verification on 2026-09-07: `npm run check:all` passed all workspace type checks
and builds, plus shared (26), database (18), payment (18), inventory (16), shipping
(20), and orchestration (31) reported tests, with no failures or skips. Reported
integration counts include parent tests; orchestration contains 30 individual scenarios.
