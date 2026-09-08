# Saga frontend

Next.js App Router workspace for the order-processing microservices. Steps 1–2 provide the application foundation, responsive shell, navigation, and shared UI components. Step 3 adds the backend proxy and RTK Query integration; live screens and Zustand UI stores belong to later steps.

Run commands from the repository root after installing dependencies with `npm ci`:

```bash
# Frontend only; infrastructure is not needed for the layout preview.
npm run dev:web
```

Open http://localhost:3004.

```bash
# Backend services and frontend together.
# Prepare the service .env files and databases first; see the backend runbook.
npm run infra:up
npm run migrate
npm run db:seed
npm run dev:all
```

`npm run dev` continues to start only the four backend services. `dev:all` starts those services and the frontend; it does not start Docker infrastructure or apply migrations automatically.

## Verification and production startup

```bash
npm run typecheck --workspace @saga/web
npm run build:web
npm run start:web
```

Production startup also uses port 3004. Stop the development server before starting production on the same port. Root `npm run build` and `npm run typecheck` include this workspace.

Development uses Turbopack. Production builds explicitly use Next.js's supported Webpack option because Turbopack's production CSS worker could not bind a local port in the implementation environment. The Webpack production build and Turbopack development page were verified successfully.

The frontend has its own TypeScript configuration because Next.js uses bundler module resolution, while the backend uses NodeNext. Dependencies are recorded in the root package-lock.json; do not create a separate workspace lockfile.

## Step 2: layout and navigation

| Route | Screen |
| --- | --- |
| `/` | Overview and workspace shortcuts |
| `/orders/new` | Create order layout preview |
| `/orders` | Order lookup and recent orders layout preview |
| `/attention` | Intervention queue layout preview |
| `/services` | Service descriptions and readiness check categories |

All routes share the desktop sidebar, header, and footer. Below 1024px, navigation opens in a native modal drawer with keyboard focus containment, Escape/backdrop dismissal, focus restoration, and scroll locking. Selecting a route or resizing to desktop closes the drawer. A skip link provides direct keyboard access to the main content.

The UI explicitly labels its preview state. Checkout and search controls are disabled; service cards say “Not checked.” No API requests, order writes, polling, or invented business metrics are included in this step.

Reusable primitives live in `src/components/ui`: buttons and links, labeled inputs, cards, status badges, icons, empty states, loading indicators, skeletons, and retryable error states. `src/components/layout` contains navigation, the application shell, page headings, and preview notices. App Router loading, error, and not-found files keep navigation available during page-level transitions and failures.

## Frontend checks

Install the browser once, then run the frontend checks from the repository root:

```bash
npm exec --workspace @saga/web -- playwright install chromium
npm run test:web
```

`test:web` runs component and API checks, builds the production application, runs Playwright at `127.0.0.1:3104`, and tests the API integration on port 3105 with isolated backend fixtures. Both ports must be free; the suite deliberately does not reuse existing servers. It stops its servers when finished and does not require Docker or real backend services.

The browser suite covers direct routes, active navigation, browser history, disabled preview controls, 404 recovery, skip-link focus, mobile drawer behavior, responsive overflow, and automated WCAG accessibility checks. It uses desktop and mobile Chromium configurations, captures a full-page image of each main screen in `apps/web/test-results`, and saves an HTML report in `apps/web/playwright-report`. These output folders are ignored by Git. Browser automation requires permission to start local processes and bind a port.

To run checks separately:

```bash
npm run test:ui --workspace @saga/web
npm run typecheck
npm run build:web
npm run test:e2e --workspace @saga/web
```

Automated accessibility checks supplement keyboard and screenshot review; they do not establish complete accessibility conformance or validate backend workflows planned for later steps.

## Verification result

Verified on 2026-09-08:

- Root `npm run typecheck` passed for the shared package, four services, and frontend.
- `npm run test:web` passed: 5 component checks, the Webpack production build, and 22 browser checks with no failures or skips.
- All five main routes returned HTTP 200; the unknown-page check returned HTTP 404 with a working recovery link.
- Automated WCAG A/AA scans reported no violations on the five pages in desktop/mobile configurations or in the open mobile drawer.
- Layout overflow checks passed on every main page at 320px, 768px, 1024px, and 1440px widths.
- Keyboard checks verified the skip link, explicit forward/reverse focus wrapping in the drawer, Escape dismissal, focus restoration, and drawer cleanup after navigation and resizing.
- Desktop and mobile screenshots were reviewed for layout and readability. The test server was managed and stopped by Playwright.

These results cover the Step 2 layout using Chromium. Backend integration, other browser engines, and later order workflows are outside this verification.

See the [frontend implementation plan](../../FRONTEND_IMPLEMENTATION_PLAN.md) and [backend startup runbook](../../docs/PART_10_VALIDATION.md).

## Step 3 — Backend connection and RTK Query

The connection layer is implemented. Pages are still Step 2 previews; later steps will consume the exported hooks. RTK Query owns server data, loading/error state, and cache invalidation. Zustand remains available for checkout drafts and local UI state. The Redux store is created per provider, not shared globally between server requests, and is not persisted.

Run from the repository root with `npm run dev:web`, then open `http://localhost:3004`. Backend URLs default to ports 3000–3003. To override them, create `apps/web/.env.local` using the settings in [`.env.example`](.env.example), then restart Next.js. These variables must remain server-only; never prefix them with `NEXT_PUBLIC_`. URLs must be HTTP(S) origins without credentials, paths, or query strings. `BACKEND_TIMEOUT_MS` defaults to 10000 and accepts 100–120000; the browser independently times out after 15000 ms.

### API coverage

All browser requests use same-origin `/api` routes. No browser CORS configuration or backend URL exposure is needed.

| Frontend route | Method | Backend |
| --- | --- | --- |
| `/api/orders` | POST | Orders: `/orders` |
| `/api/orders/:id` | GET | Orders: `/orders/:id` |
| `/api/orders/:id/history` | GET | Orders: `/orders/:id/history` |
| `/api/orders/attention` | GET | Orders: `/orders/attention` (backend fixed limit: 100) |
| `/api/orders/:id/resume` | POST | Orders: `/orders/:id/resume` |
| `/api/payments/charge`, `/api/payments/refund` | POST | Payment: matching path without `/api` |
| `/api/payments/:id` | GET | Payment: `/payments/:id` |
| `/api/inventory/reserve`, `/api/inventory/release`, `/api/inventory/finalize` | POST | Inventory: matching path without `/api` |
| `/api/inventory/reservations/:id` | GET | Inventory: `/inventory/reservations/:id` |
| `/api/shipments/create`, `/api/shipments/cancel` | POST | Shipping: matching path without `/api` |
| `/api/shipments/:id` | GET | Shipping: `/shipments/:id` |
| `/api/services/:service/health` | GET | Selected service: `/health` |
| `/api/services/:service/ready` | GET | Selected service: `/ready` |

`:service` is one of `orders`, `payment`, `inventory`, or `shipping`. The table covers 23 method/path combinations, including eight health/readiness endpoints. Unknown routes return 404 and unsupported methods return 405. This layer does not invent new backend APIs.

### Using the hooks

Import hooks from `@/lib/api/api` inside Client Components. The root layout already supplies `ApiProvider`.

```tsx
const { data, error, isFetching, refetch } = useGetOrderQuery(orderId, {
  skip: !orderId,
  pollingInterval: 0, // Later order screens control polling and stop on terminal states.
});
// data.body = validated order state; data.status = backend HTTP status
const [createOrder, submission] = useCreateOrderMutation();
const response = await createOrder({ idempotencyKey, payload }).unwrap();
// Inspect response.status AND response.body.saga.status before displaying success.
```

Every fulfilled response contains `{ body, status, retryAfter, location }`. Order mutation 422, participant business-result 409/422, pending 202, and readiness 503 are valid domain responses, not necessarily successful business outcomes. Other HTTP failures become `ApiError` objects with the original parsed body, status, and retry metadata. Malformed JSON/schema mismatches, network failures, and timeouts are distinct errors. RTK-generated abort errors can instead use Redux's serialized error shape, so narrow errors before accessing API-specific fields.

The proxy preserves JSON response bodies, HTTP status, `Retry-After`, and `Location`, disables HTTP caching, limits command bodies to 32 KiB, and never follows backend redirects. Connection failures return 503, deadlines 504, and invalid upstream responses 502. It does not forward cookies or authorization headers. **This is a local/demo integration, not an authenticated public gateway.** Add authentication/authorization before exposing operational commands publicly.

RTK keeps unused data in memory for 30 seconds, refreshes on mount/focus/reconnect, and invalidates relevant caches after mutations. It does not automatically retry writes or generate replacement idempotency keys. A timeout is an unknown outcome, not proof that an order/payment failed: inspect existing state and reuse the original key if retrying. `Retry-After` is exposed to callers rather than scheduling automatic retries.

### Connection-layer verification

```bash
npm run test:api --workspace @saga/web
npm run build:web
npm run test:api:e2e --workspace @saga/web
```

The integration test starts a production Next server on port 3105 and an isolated HTTP fixture backend on an ephemeral port. It checks actual proxy requests and RTK dispatches, readiness 503, payment rejection 422, original command bodies/keys, cache/refetch behavior, 404/405, malformed responses, timeout, and unavailable backends. It does not write to real payment, inventory, shipping, or order databases. `npm run test:web` includes these checks plus the existing component and browser suites; ports 3104 and 3105 must be free. Successful fixture tests do not establish that local PostgreSQL/RabbitMQ or real service workflows are healthy.

Verified on 2026-09-08: workspace typechecks, the production build, 10 API tests, the production-server integration test (including Chromium same-origin calls to all four service routes), 5 component checks, and 22 desktop/mobile browser regressions passed. A client-chunk scan found no backend URL environment-variable names or default backend origins. The tests cover the Step 3 connection layer, not complete live saga execution.
