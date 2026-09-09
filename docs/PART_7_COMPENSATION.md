# Compensation

Compensation undoes confirmed earlier effects through new, idempotent operations—not a cross-database rollback.

| Confirmed failure | Cleanup |
| --- | --- |
| Payment rejection | No earlier successful step to undo |
| Inventory rejection after payment | Refund payment |
| Shipping rejection after reservation | Release inventory, then refund payment |

## Rules

- Persist completed steps and cleanup progress.
- Skip cleanup already confirmed successful.
- A timeout or UNKNOWN result is not enough to assume an operation failed.
- Failed or uncertain cleanup keeps the saga COMPENSATING until recovery or intervention resolves it.
- Mark FAILED only after required compensation completes.
- Finalized inventory cannot be released; interrupted finalization needs reconciliation.

The deployed flow uses [RabbitMQ](PART_8_MESSAGING.md) and automatic [recovery](PART_9_RECOVERY.md). Older HTTP compensation code remains for regression testing.

**Checks:** `npm run test:orchestrator`, `npm run test:messaging`, and `npm run test:recovery`.
