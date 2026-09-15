# Remaining work checklist

This document lists what is still incomplete before this system should be presented as production-ready. Complete the sections in order.

## phase 1. Verified accounts

- [ ] Require verified email before creating an order or performing administrator actions.
- [x] Test verification token expiry and reuse prevention.

## phase 2. Authentication hardening

- [ ] Add a 32 KiB request-body limit and JSON content-type checks to Auth Service mutation routes.
- [ ] Add origin/CSRF protection for browser auth mutations.
- [ ] Configure trusted proxy handling; do not trust arbitrary `X-Forwarded-For` values.
- [ ] Add cleanup jobs for expired reset/verification tokens and old rate-limit records.
- [ ] Define retention periods for sessions, audit logs, and rate-limit data.
- [ ] Add password-strength guidance and optional breached-password checking.
- [ ] Add administrator MFA before public production use.
- [ ] Add account/session management: list sessions, revoke session, disable account, change email.
- [ ] Add audited administrator role-management instead of relying only on `ADMIN_EMAILS` bootstrap configuration.

## phase 3. Authentication tests

- [ ] Add an isolated Auth Service PostgreSQL integration test fixture.
- [ ] Test register, duplicate registration, and administrator bootstrap.
- [ ] Test valid/invalid login, lockout after failed attempts, and rate-limit responses.
- [ ] Test session creation, rotation, expiration, logout, and revocation after password reset.
- [ ] Test email verification and reset tokens: valid, expired, reused, and invalid cases.
- [ ] Test browser proxy authentication and unauthorized access to every protected API route.

## phase 4. Browser end-to-end tests

- [ ] Fix the current Next.js production build issue first: `npm run build:web`.
- [ ] Add Playwright flow: register → sign in → create COD order → wait for COMPLETED.
- [ ] Add Playwright flow: customer creates bank-transfer order → administrator confirms → COMPLETED.
- [ ] Add Playwright flow: customer attempts admin approval → receives `403`.
- [ ] Add Playwright flow: customer attempts another customer’s order → receives `403`.
- [ ] Add Playwright flow: logout → protected API/order access is denied.
- [ ] Run and record `npm run test:phase5` after the build issue is fixed.

## phase 5. Observability and operations

- [ ] Choose an observability stack, such as OpenTelemetry + Grafana + Prometheus/Loki/Tempo.
- [ ] Add trace propagation across Next.js, HTTP, RabbitMQ commands, and results.
- [ ] Add RabbitMQ queue depth, retry queue, and dead-letter queue metrics.
- [ ] Add business metrics: completed/failed Sagas, compensation, retries, duration, and bank-transfer approvals.
- [ ] Add authentication metrics: login failures, lockouts, reset attempts, and rate-limit events.
- [ ] Create dashboards for service readiness, failed Sagas, latency, queue backlog, and DLQ messages.
- [ ] Configure alerts for unhealthy services, broker backlog, DLQ growth, repeated auth failures, and failed approvals.
- [ ] Run a controlled alert test and document the response.

## phase 6. Production deployment and recovery

- [ ] Create Render resources from `render.paid.yaml` or configure equivalent managed services.
- [ ] Deploy Vercel frontend with all server-only service URLs and `BACKEND_API_TOKEN`.
- [ ] Set Auth Service secrets: database URL, `ADMIN_EMAILS`, public frontend URL, email provider settings, and cleanup interval.
- [ ] Use HTTPS custom domain and confirm Secure cookies work.
- [ ] Configure private databases and RabbitMQ; expose only required HTTPS service endpoints.
- [ ] Configure automated encrypted backups and point-in-time recovery where available.
- [ ] Restore a backup into an isolated environment and record the result.
- [ ] Run staging smoke tests before every production deployment.
- [ ] Rotate secrets periodically and test the backend-token rotation procedure.

## phase 7. Catalog and product administration

- [ ] Add authenticated administrator APIs to create, edit, activate/deactivate, and price products.
- [ ] Ensure price changes have an audit record and effective-time policy.
- [ ] Keep Order Orchestrator’s trusted pricing source synchronized with Inventory catalog changes.
- [ ] Add product images through a managed asset source.
- [ ] Add stock-adjustment history and administrator stock-management UI.

## Final release gate

Do not label the system production-ready until all items in sections 1–6 are complete, the full Phase 5 suite passes, browser journeys pass, and a staging deployment plus backup restore has been verified.
