# Operations runbooks

## Failed or stuck Saga

1. Open the order and record order ID, Saga ID, request ID, and current operation.
2. Check Services readiness and `/metrics`; restore any unavailable database, broker, or participant.
3. Read the immutable order history and structured logs by order/Saga ID.
4. If the order requires intervention, an administrator uses **Resume order** once dependencies are healthy.
5. Do not manually issue payment, inventory, or shipment commands while a Saga is active.

## Dead-letter queue or growing backlog

1. Preserve the message and inspect its message ID, routing key, and error reason.
2. Fix the consumer/configuration problem first.
3. Confirm the affected Saga and receipt/inbox state before replaying a message.
4. Replay only through the approved broker process. Idempotency protects duplicate delivery, but it does not make an incorrect command safe.

## Bank-transfer confirmation

1. Confirm the order belongs to a bank-transfer payment and is pending approval.
2. Sign in as an administrator.
3. Confirm once from the order view; record the order ID and request ID.
4. Follow the Saga to terminal state. If uncertain, refresh the order—never create another order as a substitute.

## Session/security incident

1. Rotate `BACKEND_API_TOKEN` across all backend services and Vercel if it may be exposed.
2. For an account incident, revoke that user's sessions in `auth-db` and require a password reset.
3. Review `auth_audit_logs` and structured logs using user ID and request IDs; do not export secret tokens.

## Database restore

1. Stop affected writers and preserve the incident time.
2. Restore into an isolated environment first and validate migrations, readiness, and data ownership.
3. Compare order/Saga state with participant receipts and outboxes before reconnecting services.
4. Resume workers gradually; monitor duplicate-effect and compensation metrics.
5. Document recovery actions, timestamp, and any orders requiring manual review.
