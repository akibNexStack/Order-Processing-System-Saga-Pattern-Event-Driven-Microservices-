# API and security model

## Browser API

The browser calls same-origin Next.js routes. The proxy verifies the `saga_session` HttpOnly cookie with Auth Service, then supplies trusted identity headers to backend services. `customerId` from a browser request is ignored.

| Route | Permission | Notes |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Creates account and session cookie. |
| `POST /api/auth/login` | Public | Rate-limited; rotates existing sessions. |
| `GET /api/auth/session` | Signed-in user | Current user only. |
| `POST /api/orders` | Signed-in user | Owner derived from session. |
| `GET /api/orders/:id` and `/history` | Owner or admin | Other customers receive `403`. |
| `POST /api/orders/:id/resume` | Admin | Operational recovery. |
| `POST /api/orders/:id/confirm-payment` | Admin | Bank-transfer approval only. |
| `GET /api/products` | Signed-in user | Live inventory snapshot. |

## Important HTTP results

| Status | Meaning |
| --- | --- |
| `401` | No valid session or backend credential. |
| `403` | Authenticated but not allowed. |
| `409` | Idempotency/state conflict. |
| `422` | Business validation failure, for example unavailable stock. |
| `503` | A dependency could not safely complete the request; retry only with the same idempotency key where applicable. |

## Production requirements

- Use HTTPS and keep `Secure`, `HttpOnly`, `SameSite=Lax` session cookies.
- Keep `BACKEND_API_TOKEN` server-only; rotate it across Vercel and every backend together.
- Keep databases and RabbitMQ private. `/health` is liveness only; `/ready` and business routes require service access.
- Set `ADMIN_EMAILS` before administrator registration. Use a real email delivery provider before enabling public account verification/reset flows.
- Never log passwords, tokens, addresses, raw database errors, or message payloads. Use request IDs, order IDs, Saga IDs, and message IDs for investigation.
