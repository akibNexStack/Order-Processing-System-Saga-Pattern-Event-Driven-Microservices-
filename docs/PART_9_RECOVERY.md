# Part 9 — Recovery and observability

The orchestrator now starts a recovery worker automatically. It scans unfinished
IN_PROGRESS and COMPENSATING sagas, resumes missing responses safely, and surfaces
orders that need intervention. Participant and orchestrator outbox relays continue
publishing durable pending messages after restart or broker reconnection.

## Run

```bash
npm run infra:up
npm run migrate
npm run dev
```

The new orchestrator migration adds `response_deadline_at`, `recovery_attempts`, and
`intervention_reason`. Existing `.env` files use these defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| SAGA_COMMAND_TIMEOUT_MS | 30000 | Response deadline per command attempt; allowed 1000–3600000 ms |
| RECOVERY_INTERVAL_MS | 1000 | Scan interval; allowed 100–60000 ms |

The scan takes up to ten due sagas and uses 30-second persisted leases. It runs again
after finishing each batch, rather than overlapping scans in one process.

## Recovery guarantees

A scan claims due rows using PostgreSQL row locks with SKIP LOCKED. Each claim commits
a fresh lease token and expiry before recovery work begins. Recovery re-locks the row
and checks the token, expiry, active status, and intervention state. A different
worker can reclaim an expired lease; the old token can no longer advance that saga.
Results also lock the saga and clear leases, fencing off recovery based on stale state.

Recovery retries the pending operation using a **new message ID and the same business
idempotency key**. New message IDs allow reconciliation even if an earlier inbox entry
already exists; participant receipts/provider keys prevent duplicate business effects.
The new pending ID, history, deadline, retry count, and outgoing command commit together.
Late results from earlier attempts cannot overwrite newer progress.

An unpublished command stays with the outbox relay. Recovery postpones its deadline
without consuming retries or creating more commands. After publication, a full response
timeout is allowed from `published_at`, so delayed broker delivery does not immediately
exhaust the budget. `nextAttemptAt` schedules the next scan; `responseDeadlineAt` exposes
the waiting deadline. Outbox `available_at` separately schedules message publication.

Missing payment, inventory, shipping, or cleanup results remain uncertain. Recovery
reconciles them before deciding the next business action. It never compensates solely
because a response timed out. Lost inventory-finalization results resume finalization;
finalized stock is never released by recovery.

The existing three-command-attempt budget applies to each operation, including
response-timeout retries. `recoveryAttempts` separately records recovery dispatches.
Confirmed step progress resets per-operation counters. Total `attempts` remains an
audit count. A saga with no pending command (including an older HTTP-era saga) can
also be resumed automatically from its recorded progress.

## Intervention and history

```bash
curl http://localhost:3000/orders/attention
curl http://localhost:3000/orders/<orderId>
curl http://localhost:3000/orders/<orderId>/history
curl -X POST http://localhost:3000/orders/<orderId>/resume
```

Replace `<orderId>` with the actual UUID. Attention lists up to 100 flagged orders,
most recently updated first. Status includes `requiresManualIntervention` and the
persisted `saga.interventionReason`. History provides ordered timestamps, events,
steps, directions, state changes, message IDs, reasons, and readable summaries.
GET endpoints do not advance work.

| Reason | Meaning |
| --- | --- |
| COMMAND_RETRIES_EXHAUSTED | Valid unsuccessful/uncertain responses exhausted the command retry budget |
| RECOVERY_RETRIES_EXHAUSTED | Missing responses exhausted automatic recovery attempts |
| INCONSISTENT_PROGRESS | Stored steps, operation, finalization state, or command payload are inconsistent |
| MISSING_COMMAND | The pending command is absent from the outbox or is not a command |

Flagged orders remain IN_PROGRESS or COMPENSATING, not falsely FAILED. Automatic scans
skip them. After fixing the underlying problem, POST/resume (or the original order POST)
starts another bounded cycle with a new delivery ID and the same business key. It can
also replace an outstanding attempt that was flagged for missing responses. Corrupt
progress must be repaired before resume; resume does not bypass validation. A matching
late result for the still-pending attempt may resolve an intervention naturally.

## Readiness and logs

Each service exposes:

- `GET /health`: process liveness.
- `GET /ready`: 200 when its database probe and RabbitMQ consumer/publisher are ready;
  otherwise 503 with component booleans. The orchestrator also requires a recently
  successful recovery scan.

Readiness becomes false when the worker stops, its connection closes, the consumer is
cancelled, or RabbitMQ reports the connection blocked. Database failures are reported
without returning connection strings or raw errors. Readiness describes dependencies;
it does not mean every order has completed or that the attention list is empty.

Runtime logs are JSON lines with timestamp, service, event, and relevant orderId,
sagaId, messageId, operation, route, or lease token. Events cover publish confirmation,
message processing, retry/dead-letter routing, broker connection changes, recovery
checks, and startup failures. The logger uses an allowlist, excluding command payloads,
customer addresses, secrets, and raw SQL/error text. Durable transition history remains
the authoritative record of committed saga progress.

## Verification and limits

```bash
npm run test:recovery
npm run check:all
```

Recovery integration tests use real RabbitMQ and temporary databases. They cover lost
payment, compensation and finalization results, restarted recovery workers, concurrent
claims, expired leases, late results, unpublished commands, bounded intervention,
legacy pending work, readiness, history, and log fields. Earlier messaging tests also
verify pending outbox publication after reconnect and commit/acknowledgement failures.

These are local development services with simulated external providers and internal
APIs. The worker supports restart recovery through persisted state. [Part 10](PART_10_VALIDATION.md)
adds targeted OS-process-kill tests and isolated broker restart tests. Multi-node
broker failover and production deployment validation remain outside this local demo. Outbox/inbox retention and external log/metrics aggregation are not
implemented by this part.

Verification on 2026-09-07: `npm run check:all` passed all builds, type checks,
and shared, database, participant, HTTP saga, RabbitMQ, and recovery tests, with
no failures or skips. The recovery suite reports 15 tests including its parent
test (14 individual scenarios). The migration was applied locally,
`npm run db:generate --workspace order-orchestrator` found no schema drift, and
`git diff --check` passed.
