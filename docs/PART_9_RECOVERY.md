# Recovery and observability

A background worker scans unfinished sagas and safely retries missing results. Outbox relays resume pending publication after reconnection or restart.

## Recovery behavior

- Database leases and tokens prevent stale workers from advancing a saga.
- Retries use a new message ID but the same business idempotency key.
- Unpublished commands remain with the outbox instead of exhausting response retries.
- Late results cannot overwrite newer progress.
- Timeouts trigger reconciliation, not assumed failure or automatic refund.
- Exhausted retry budgets expose the order for manual intervention.

## Operator workflow

1. Inspect `GET /orders/attention` (maximum 100 records).
2. Read order state and `GET /orders/:orderId/history`.
3. Restore the failed dependency.
4. Use `POST /orders/:orderId/resume` for eligible unfinished work.
5. Follow status until COMPLETED or fully compensated FAILED; 202 alone is not success.

All services expose `GET /health` and `GET /ready`. Health checks process liveness; readiness checks dependencies. Hosted readiness and business endpoints require the shared Bearer token.

Free services that sleep cannot run background recovery while asleep. Wake all four services before a demo.

**Check:** `npm run test:recovery`. See [runbook](PART_10_VALIDATION.md).
