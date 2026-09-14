# Production Implementation Plan

This roadmap evolves the Saga Order System from a learning/portfolio implementation into a production-ready internal order-processing platform. Complete phases in order unless a task explicitly has no dependency.

## Scope and roles

| Role | Allowed actions |
| --- | --- |
| Unauthenticated visitor | Register, sign in, password recovery only |
| Customer | Create orders and view only their own orders |
| Administrator | View all orders, inspect attention/recovery queues, resume eligible work, and confirm bank transfers |

The system remains an internal COD and bank-transfer workflow. It does not process real card payments.

## Phase 1 — Server-side identity and order ownership

**Goal:** Never trust a customer ID supplied by the browser. Protect every order resource with a verified session and role.

### Tasks

1. Remove `customerId` from the browser's create-order payload.
2. Validate the `saga_session` cookie in the Next.js API proxy through Auth Service.
3. Forward only verified internal identity and role information to the Order Orchestrator.
4. Make the orchestrator persist the verified user ID as the order owner.
5. Protect order detail, history, payment, reservation, shipment, attention, recovery, and confirmation routes.
6. Enforce `CUSTOMER` ownership and `ADMIN` privileged operations.
7. Return `401 Unauthorized` for no valid session and `403 Forbidden` for insufficient permissions.

### Verification

- Customer A cannot read Customer B's order.
- Customer receives `403` for bank-transfer confirmation and recovery actions.
- Administrator can access the attention queue and confirm a bank transfer.
- Browser-supplied owner/customer identifiers have no effect.

**Completion checkpoint:** identity is verified server-side from session to database.

## Phase 2 — Authentication security and account lifecycle

**Goal:** Make email/password accounts safe for an internal production system.

### Tasks

1. Rotate sessions on login and revoke sessions on password change.
2. Implement session expiration, explicit logout, and a session-cleanup job.
3. Use `HttpOnly`, `SameSite`, and production HTTPS-only cookies.
4. Rate-limit registration, login, password-reset, and verification endpoints.
5. Record failed login attempts and temporarily lock accounts after repeated failures.
6. Use generic login errors so attackers cannot discover registered emails.
7. Add audit events for registration, login success/failure, logout, password changes, role changes, and bank-transfer confirmations.
8. Add email-verification and password-reset token flows.
9. Add an email-provider interface; local development may log links instead of sending mail.
10. Add a secure administrator bootstrap and role-management process.

### Verification

- Expired, revoked, and rotated sessions cannot be used.
- Login rate limits and account lockouts work.
- Password reset invalidates existing sessions.
- Administrator actions create audit records.

**Completion checkpoint:** accounts have a secure lifecycle and an audit trail.

## Phase 3 — Dynamic catalog and inventory availability

**Goal:** Replace static browser catalog data with service-owned product and stock APIs.

### Tasks

1. Extend Inventory Service product records with name, SKU, price, active state, and stock.
2. Add migrations and seed data for product catalog fields.
3. Add `GET /products` and `GET /products/:id` endpoints.
4. Update checkout cards to fetch product name, price, image/artwork, and current availability from the API.
5. Add loading, error, empty, inactive, and unavailable product states.
6. Prevent choosing unavailable products in the UI.
7. Keep the Order Orchestrator as the server-side price authority and Inventory reservation as the final availability authority.

### Verification

- Checkout displays API-backed products and pricing.
- Availability changes appear after refresh.
- A stale browser stock snapshot cannot cause an oversell; reservation still decides final success.

**Completion checkpoint:** frontend catalog data is dynamic, while backend validation remains authoritative.

## Phase 4 — Observability and operations

**Goal:** Diagnose an order or failed Saga from logs, traces, metrics, and operational screens.

### Tasks

1. Emit structured JSON logs from every service.
2. Include request ID, order ID, saga ID, message ID, user ID, service, and operation in logs.
3. Add metrics for completion/failure rates, Saga duration, retries, compensation, auth failures, queue depth, DLQ size, and database health.
4. Add OpenTelemetry tracing across HTTP and RabbitMQ message boundaries.
5. Add dashboard panels for service health, queue backlog, DLQ messages, failed Sagas, and latency.
6. Configure alerts for DLQ growth, unhealthy services, backlog, repeated login failures, and failed bank-transfer confirmation.

### Verification

- A trace ID follows one order through all services.
- A failed order can be diagnosed without manually searching every service.
- DLQ and queue backlog alerts fire in a controlled test.

**Completion checkpoint:** operations staff can detect and investigate failures promptly.

## Phase 5 — End-to-end, integration, and resilience tests

**Goal:** Prove normal workflows and failure recovery with automated tests.

### Tasks

1. Add browser E2E tests for registration, login, COD checkout, and completed Saga status.
2. Add E2E tests for bank transfer: customer creates order, admin approves it, Saga completes.
3. Add authorization E2E tests for cross-user order access and `403` admin restrictions.
4. Add integration tests for duplicate HTTP requests and duplicate RabbitMQ messages.
5. Test payment rejection, insufficient inventory, shipment failure, and compensation.
6. Stop RabbitMQ, a participant service, the orchestrator, and a database during controlled test runs.
7. Verify outbox publishing, inbox idempotency, recovery worker behavior, and no duplicate side effects.
8. Add concurrency/load tests for limited stock and parallel order creation.

### Verification

- Every critical path runs in CI.
- Restart/failure tests prove recovery without duplicate charges, reservations, or shipments.
- Concurrent reservations do not oversell inventory.

**Completion checkpoint:** the system has repeatable evidence of correctness under normal and failure conditions.

## Phase 6 — Production deployment, backups, and release process

**Goal:** Deploy safely with isolated infrastructure, protected secrets, and tested recovery.

### Tasks

1. Deploy the frontend, each backend service, PostgreSQL databases, and RabbitMQ using managed production infrastructure.
2. Use private service networking; expose only required public endpoints.
3. Configure separate production secrets, service URLs, database credentials, RabbitMQ credentials, administrator bootstrap, and cookie settings.
4. Validate required environment variables at service startup.
5. Add CI for formatting, typechecks, unit/integration/E2E tests, dependency checks, and security scans.
6. Run database migrations before application rollout and include rollback/release procedures.
7. Configure automated encrypted backups and routinely test restore procedures.
8. Define data retention periods for orders, sessions, logs, and audit events.
9. Write disaster-recovery procedures for database loss, broker loss, and service incidents.

### Verification

- Staging deploy passes smoke tests before production rollout.
- A database restore succeeds in a non-production environment.
- Production cookies are HTTPS-only and no secrets are committed to Git.

**Completion checkpoint:** the system can be deployed, monitored, backed up, and recovered safely.

## Phase 7 — Documentation and final alignment

**Goal:** Make the system understandable to developers, operators, and reviewers.

### Tasks

1. Add architecture, database ownership, authentication, and authorization diagrams.
2. Add COD and bank-transfer sequence diagrams.
3. Document RabbitMQ exchanges, queues, retry queues, DLQs, routing keys, outbox, and inbox behavior.
4. Document API endpoints, request/response contracts, permissions, and error codes (`401`, `403`, `409`, `422`, `503`).
5. Add setup, environment-variable, deployment, security, backup, and incident-recovery guides.
6. Add operational runbooks for failed Sagas, DLQ messages, bank-transfer approval, session revocation, and database restore.
7. Remove remaining outdated “demo” wording, fixtures, and assumptions.
8. Ensure UI text, backend behavior, tests, and documentation all describe the same product.

### Verification

- A new developer can start the platform from the setup guide.
- An operator can recover a failed Saga from a runbook.
- Documentation matches the deployed behavior and automated tests.

**Completion checkpoint:** the repository is understandable and operable without tribal knowledge.

## Recommended sequence

```text
Phase 1: Server-side identity and authorization
    ↓
Phase 2: Account security
    ↓
Phase 3: Dynamic catalog and availability
    ↓
Phase 5: E2E, integration, and resilience tests
    ↓
Phase 4: Observability and operations
    ↓
Phase 6: Production deployment and data safety
    ↓
Phase 7: Documentation and cleanup
```

Start with Phase 1. All later production work depends on a trustworthy server-side user identity and role model.
