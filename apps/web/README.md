# Saga frontend

A responsive Next.js workspace for creating demo orders, tracking distributed processing, inspecting service health, and recovering interrupted workflows. Payment and shipping providers are simulations, not real financial or delivery services.

For instructions on using the interface, read the [User Guide](../../docs/USER_GUIDE.md). This page covers frontend setup and development.

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Service readiness, attention queue, and recent order IDs |
| `/features` | Platform capabilities and a step-by-step user guide |
| `/orders/new` | Validated checkout with safe, same-key retries |
| `/orders` | Order lookup by UUID and browser-local recent history |
| `/orders/[orderId]` | Saga progress, event history, payment/inventory/shipment state, and guarded resume |
| `/attention` | Up to 100 orders requiring intervention |
| `/services` | Independent health/readiness checks for all four services |

Desktop and mobile navigation include keyboard access, focus management, and responsive layouts. Direct participant commands are available through the [Postman collection](../../postman/README.md); normal checkout and compensation are coordinated automatically by the backend.

## Local setup

Use Node.js 24 and run commands from the repository root:

```bash
npm ci
npm run dev:web
```

Open `http://localhost:3004`. Configure backend origins in `apps/web/.env.local` using [`.env.example`](.env.example). Follow the [backend runbook](../../docs/PART_10_VALIDATION.md) to configure service databases and RabbitMQ, then run:

```bash
npm run infra:up
npm run migrate
npm run db:seed
npm run dev:all
```

Use either `dev:web` or `dev:all`, not both on the same port. Stock seeding does not replenish consumed inventory.

## Backend integration

The browser calls same-origin `/api/*` routes. The server proxy routes allowlisted requests to the appropriate service and adds the private backend Bearer token. RTK Query manages server responses and cache invalidation; Zustand manages in-memory checkout and browser preferences.

For Vercel, [`.env.vercel.example`](.env.vercel.example) lists the four live Render origins. Set all four service URLs and `BACKEND_API_TOKEN` privately in Vercel. Never prefix them with `NEXT_PUBLIC_` or commit a real token. Missing origins are rejected on Vercel instead of falling back to localhost.

See [Vercel configuration and release checks](../../DEPLOYMENT.md). Protect both frontend pages and API routes for a private demo: the backend token does not authenticate visitors. Wake all four free services and verify readiness before checkout.

## Workflow and data boundaries

- A submitted or pending order is not completed. Follow status and history until COMPLETED or fully compensated FAILED.
- Unknown submission outcomes retain the original payload and idempotency key for explicit retry. Keep the tab open; reloads can lose the in-memory retry state. Reconcile an uncertain order before creating a replacement.
- Active orders poll; terminal and intervention-required orders stop polling. Participant and history snapshots refresh independently and are not one atomic cross-service snapshot.
- Resume is an explicit action for unfinished orders. Inspect errors and restore failed dependencies first; accepted recovery is not guaranteed completion.
- Only recent order IDs and the history preference persist in browser storage. Customer details, addresses, tokens, and API response bodies do not. Recent history is not a complete server-side order list.
- Product choices reflect demo seed data, not live stock or a pricing API. There is no restocking screen, user-account management, or arbitrary order-cancellation workflow.

## Build and test

```bash
npm run typecheck --workspace @saga/web
npm run build:web
npm run start:web
```

Production startup uses port 3004. The production build uses Webpack; development uses Turbopack. Dependencies belong in the root workspace lockfile.

```bash
npm exec --workspace @saga/web -- playwright install chromium
npm run test:web
```

Frontend checks cover UI components, API routing, state, checkout, lookup, history, compensation displays, recovery, polling, service outages, and desktop/mobile accessibility. The standard frontend suite uses controlled backend responses and local test ports 3104/3105. Generated screenshots and browser reports are ignored by Git.

For full-stack release checks with disposable PostgreSQL/RabbitMQ infrastructure, run `npm run verify:release`. Local tests do not establish hosted availability: verify readiness, successful checkout, out-of-stock compensation, reload/history, and private access on the actual deployment before presenting it.
