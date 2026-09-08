# Saga frontend

Next.js App Router workspace for the order-processing microservices. Steps 1–2 provide the application foundation, responsive shell, navigation, and shared UI components. Step 3 adds the backend proxy and RTK Query integration; Step 4 adds Zustand state, persistence, and hydration. Step 5 connects the live Services screen, and Step 6 adds the editable checkout form and local validation. Order submission remains in Step 7.

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
| `/orders/new` | Demo checkout form, local validation, and order summary |
| `/orders` | Order lookup and recent orders layout preview |
| `/attention` | Intervention queue layout preview |
| `/services` | Live health/readiness, dependency results, timestamps, and refresh |

All routes share the desktop sidebar, header, and footer. Below 1024px, navigation opens in a native modal drawer with keyboard focus containment, Escape/backdrop dismissal, focus restoration, and scroll locking. Selecting a route or resizing to desktop closes the drawer. A skip link provides direct keyboard access to the main content.

Checkout fields are editable as of Step 6, but Create order remains disabled; Validate order performs local checks only. Order search is still a disabled preview. The Services screen is live as of Step 5 and makes read-only health/readiness requests; it does not submit orders or modify services.

Reusable primitives live in `src/components/ui`: buttons and links, labeled inputs, cards, status badges, icons, empty states, loading indicators, skeletons, and retryable error states. `src/components/layout` contains navigation, the application shell, page headings, and preview notices. App Router loading, error, and not-found files keep navigation available during page-level transitions and failures.

## Frontend checks

Install the browser once, then run the frontend checks from the repository root:

```bash
npm exec --workspace @saga/web -- playwright install chromium
npm run test:web
```

`test:web` runs component, Zustand state, and API checks, builds the production application, runs Playwright at `127.0.0.1:3104`, and tests the API integration on port 3105 with isolated backend fixtures. Both ports must be free; the suite deliberately does not reuse existing servers. It stops its servers when finished and does not require Docker or real backend services.

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

The connection layer is implemented. The Services screen consumes its hooks as of Step 5; order screens remain previews. RTK Query owns server data, loading/error state, and cache invalidation. Zustand remains available for checkout drafts and local UI state. The Redux store is created per provider, not shared globally between server requests, and is not persisted.

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

## Step 4 — Zustand state and lifecycles

`StateProvider` creates separate vanilla Zustand stores for each mounted application tree. There are no module-level store instances to leak checkout data between server requests. The root provider remains mounted during client-side route changes. RTK Query still owns order details, history, participant results, service health/readiness, API errors, and cache invalidation; those values are not copied into Zustand.

| Store | Responsibilities | Persisted? |
| --- | --- | --- |
| `checkoutStore` | Selected items, customer/amount/currency/address draft, idempotency key, immutable submitted request, local submission phase/error | No |
| `uiStore` | Mobile drawer, storage hydration status, recent order IDs, remember-history preference | Only IDs and preference |

Import selector hooks from `@/components/providers/state-provider` in Client Components. Select individual fields/actions, or use Zustand's `useShallow` for selectors returning a new object/array. Do not construct a new object in a selector without a stable equality strategy.

```tsx
const draft = useCheckoutStore(state => state.draft);
const updateDraft = useCheckoutStore(state => state.updateDraft);
const hydration = useUiStore(state => state.hydration);
const recentOrderIds = useUiStore(state => state.recentOrderIds);
const addRecentOrder = useUiStore(state => state.addRecentOrder);

// Partial top-level update; pass a complete address when replacing that field.
updateDraft({ shippingAddress: { ...draft.shippingAddress, city: "Dhaka" } });
// After a real response provides a valid order ID, and hydration is no longer pending:
addRecentOrder(orderId);
```

### Checkout lifecycle contract

- `updateDraft(patch)` copies the input and succeeds only while `submission` is `idle`. Drafts may be incomplete; `beginSubmission()` validates the complete request using the shared contract.
- `beginSubmission()` generates a cryptographically random key, freezes a validated request snapshot, changes the phase to `submitting`, and returns a separate request copy. It returns `null` for invalid input, unavailable secure key generation, or an already-locked checkout. It does **not** send a request.
- `markUncertain(key, message)` records an unknown outcome after a timeout/network failure. Draft changes and reset remain blocked. `retrySubmission()` returns the exact original normalized payload/key and moves back to `submitting`; it never generates a replacement key.
- `markSettled(key)` is for a definitive submission response or confirmed reconciliation. A known order accepted with 202 can settle the submission even while its saga continues running. Do not call it merely because a request timed out or returned an ambiguous infrastructure failure.
- `resetCheckout()` clears draft, key, request, and error only when idle/settled. A subsequent submission gets a new key. Callbacks with a different key are ignored. These are lifecycle primitives for Step 7, not live checkout wiring.

Shipping addresses, customer IDs, item selections, request snapshots, keys, and submission errors are **never written to localStorage/sessionStorage**. They survive client-side navigation but not a full reload, tab close, or provider unmount. Do not reload an unresolved checkout expecting an automatic retry: this step does not promise duplicate prevention across reloads. Reconcile existing orders before starting a replacement checkout. The Step 7 UI must explain that limitation when live submission is introduced.

### Hydration and persistence contract

The first server/browser render uses deterministic defaults with `hydration: "pending"`. A mount effect reads `saga:ui:v1`, restores allowlisted preferences, then marks hydration `ready`. History/preference mutations return `false` while hydration is pending, so a premature write cannot overwrite saved history. Navigation does not wait for storage.

Persisted format: `{ version: 1, state: { rememberRecentOrders, recentOrderIds } }`. IDs are validated UUIDs, normalized to lowercase, deduplicated, ordered most-recent-first, and capped at 20. Invalid JSON/versions fall back to defaults; unrecognized fields and any injected private data are discarded when this owned storage key is rewritten. Other storage keys are untouched.

`addRecentOrder`, `removeRecentOrder`, and `clearRecentOrders` manage the list. `setRememberRecentOrders(false)` clears remembered IDs and rejects new additions until enabled again. These actions are ready for the Step 8 recent-orders UI; there is no fabricated order history on today's preview pages.

Blocked storage, read failures, or quota errors set hydration to `unavailable` without crashing the app. History remains usable in memory, but persistence/clearing on disk cannot be guaranteed while storage is unavailable. Repeated hydration effects retain current state and clean up their subscriptions. Drawer state is never restored from storage; path changes, Escape/backdrop dismissal, and desktop resizing close it. Separate tabs do not synchronize live: saved preferences are restored on mount, and later writes are last-writer-wins.

### State-layer checks

```bash
npm run test:state --workspace @saga/web
npm run typecheck
npm run test:web
```

State tests cover store isolation, deterministic SSR, missing-provider errors, draft copying, request validation, duplicate guards, immutable retries, stale keys, reset rules, hydration, recent-ID limits/ordering, opt-out, malformed storage, storage failures, and subscription cleanup. Browser tests use the real application to check hydration/reload, persisted-data sanitization, opted-out history, and navigation with blocked storage. Existing navigation/accessibility tests remain in the regression suite. No real backend/database writes are required.

Verified on 2026-09-08: root `npm run typecheck` and the complete `npm run test:web` suite passed. Results: 5 component checks, 14 state/provider checks, 10 API checks, the production build, 30 desktop/mobile Chromium checks (including 8 new state checks), and 1 isolated production-server API integration test. No failures or skips were reported. Formatting and `git diff --check` also passed. This verifies the implemented state layer and existing frontend regressions; full live checkout/saga execution remains outside Step 4.

## Step 5 — Live service status

Run `npm run dev:web` from the repository root and open `http://localhost:3004/services`. To observe healthy real services, prepare PostgreSQL/RabbitMQ and the backend service configuration, then start the services using the startup instructions above. An unavailable card is expected when its backend is stopped; `/health` can respond while `/ready` reports dependency failures.

The screen sends eight independent read-only requests through Next.js: `/api/services/{orders,payment,inventory,shipping}/{health,ready}`. RTK Query owns all results; nothing is copied into Zustand or persisted to browser storage. Checks run on entry, manual refresh, focus, and reconnect. There is no periodic polling and no claim of continuous monitoring.

Each service card displays:

- Health: **Responding**, **Checking…**, or **Unavailable**, with a readable error when a response cannot be verified.
- Readiness: **Ready**, **Not ready**, **Checking…**, **Unavailable**, or **Incomplete checks**. A valid readiness 503 displays its reported dependency results, not a generic network error.
- Separate Database and Broker results, plus Order recovery for the orchestrator. Results are **Available**, **Unavailable**, or **Unknown**. Missing/configuration-failure responses never invent failed or successful dependency checks.
- A local-time timestamp for each completed health/readiness response. On a request failure, “Last attempt” shows when that attempt started. During refresh, previous completion timestamps may remain visible, but old readiness/dependency successes are hidden until a fresh result arrives.
- A per-service Refresh button. Refresh all services checks every endpoint; controls are disabled while their requests are in progress. A slow/unavailable service does not hide other results or disable the other cards' refresh controls.

Wrong health service identities, malformed JSON, schema errors, and a “ready” body containing failed dependency checks are rejected. Timeouts, network failures, and other HTTP errors display distinct explanations. The screen performs no order submissions, recovery commands, or service mutations.

Browser coverage in `tests/services.spec.ts` includes initial loading, timestamps, healthy responses, dependency failures, unconfigured checks, partial outages, slow endpoints, single/all refresh, stale-success removal, invalid responses, and recovery from an all-down state. Layout/accessibility tests use deterministic HTTP fixtures; the isolated integration test additionally opens the real Services page and verifies the complete browser → RTK Query → Next proxy → HTTP backend path. These tests verify the frontend behavior, not the availability of your real databases or broker.

Verified on 2026-09-08: workspace typechecks, production build, 42 browser checks, 14 state/provider checks, 10 API checks, 5 component checks, and 1 isolated integration check passed (72 total). The initial integration run hit its old 100 ms test deadline during the eight-request burst; after raising only that fixture deadline to 1000 ms, the integration rerun passed, including explicit timeout handling. Production timeout defaults were not changed. Desktop outage and mobile healthy screenshots were reviewed, and formatting/diff checks passed. No real order/payment/inventory/shipping records were changed by verification.

## Step 6 — Checkout form and local validation

Run `npm run dev:web` and open `http://localhost:3004/orders/new`. This step needs no running backend: **Validate order** validates locally; **Create order** is intentionally disabled until Step 7. Entering a form, pressing Enter, validating, and clearing the draft do not send orders, charge payments, or reserve inventory. Validation does not generate an idempotency key or put the checkout into a submitting state.

The three choices match `services/inventory-service/src/db/seed.ts`: Demo Keyboard, Demo Mouse, and Demo Monitor. Displayed seed stock (100, 50, and 0 respectively) is historical initialization data, not live availability. Monitor remains selectable for the insufficient-stock demo. The browser does not import backend/database modules, and a test detects catalog drift from the seed file. There is no catalog-price API, so the amount is explicitly a manually entered **demo total**, not a product-derived price or quote.

### Fields and validation

- Customer ID must be a UUID. Selected products must have whole quantities from 1 through 10,000; at least one item is required.
- Currency is BDT or USD. Changing currency changes the currency code only; it does not perform exchange-rate conversion.
- Amounts use digits with an optional one/two-digit decimal fraction, such as `12`, `12.3`, or `12.30`. The supported range is `0.01` through `99999999.99`. Negative values, exponents, commas, trailing decimal points, zero, excessive precision, and out-of-range values are rejected rather than rounded. Enter `0.50`, not `.50`.
- Amount conversion splits the decimal string into whole/fractional integer parts, so `0.29` is exactly 29 minor units. The raw amount string stays in Zustand memory during edits/navigation; the numeric draft is `null` when that string is invalid.
- Shipping requires recipient, address line 1, city, postal code, and a two-uppercase-letter country code. Line 2 and region are optional; whitespace-only optional values are omitted from the validated payload. Customer UUIDs and country codes are normalized consistently. These checks match the backend contract; they do not verify that a customer, postal address, or product is operationally available.

Errors are linked to their fields and the first invalid control receives focus after validation. After an unsuccessful validation, errors update as fields are corrected. Editing any value clears the previous success announcement. The summary shows selected products/quantities, the demo total, exact minor units, and entered delivery details without inventing totals or stock guarantees.

The pure helpers in `src/lib/checkout/form.ts` validate the payload and can build a complete shared-contract request when Step 7 supplies an idempotency key. The checkout store's existing submission preparation uses the same normalization, so optional blank address fields cannot pass form validation and later fail solely because of different normalization.

Drafts, including raw amount text and private delivery fields, survive client-side navigation only. They are not written to localStorage or sessionStorage, and a full reload clears them. **Clear draft** resets the draft, amount text, and local feedback. Existing submission locks still protect an in-flight or uncertain checkout from editing.

### Checks

`npm run test:state --workspace @saga/web` includes seed parity, exact amount boundaries/round trips, invalid money formats, shared-schema request construction, address normalization, quantity/duplicate validation, and synchronized/locked/reset amount state. `npm run test:web` additionally runs desktop/mobile form checks for valid and invalid entries, error focus and accessibility, summaries, product selection, no writes, navigation persistence, reset, and reload clearing, alongside all prior regression suites. Backend acceptance and real order submission remain outside this step.

Verification on 2026-09-08: workspace typechecks, production build, 5 component checks, 20 state/provider checks, 10 API checks, 50 desktop/mobile Chromium checks, and 1 isolated real-proxy integration check passed across suite runs and targeted reruns (86 checks). Initial browser runs exposed ambiguous test selectors for required labels and the repeated checkout notice/footer; those selectors were corrected. The subsequent browser run passed 48 checks, and both remaining checkout layout checks passed with `npm run test:e2e --workspace @saga/web -- --last-failed`. Desktop/mobile checkout screenshots were reviewed; automated accessibility scans reported no violations in the tested states. This does not assert real PostgreSQL/RabbitMQ availability or live order acceptance.
