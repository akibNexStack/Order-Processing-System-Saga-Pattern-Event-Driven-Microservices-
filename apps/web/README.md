# Saga frontend

Step 9 adds safe automatic status polling to active order details, alongside read-only lookup, browser-local recent orders, and independently refreshable participant sections.

Next.js App Router workspace for the order-processing microservices. Steps 1–2 provide the application foundation, responsive shell, navigation, and shared UI components. Step 3 adds the backend proxy and RTK Query integration; Step 4 adds Zustand state, persistence, and hydration. Step 5 connects the live Services screen, Step 6 adds checkout validation, and Step 7 connects order submission with duplicate prevention and explicit same-key retries.

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
| `/orders/new` | Demo checkout, local validation, live submission, and safe retry |
| `/orders/[orderId]` | Order details, participant snapshots, and an optional original submission receipt |
| `/orders` | UUID lookup and browser-local recent orders |
| `/attention` | Intervention queue layout preview |
| `/services` | Live health/readiness, dependency results, timestamps, and refresh |

All routes share the desktop sidebar, header, and footer. Below 1024px, navigation opens in a native modal drawer with keyboard focus containment, Escape/backdrop dismissal, focus restoration, and scroll locking. Selecting a route or resizing to desktop closes the drawer. A skip link provides direct keyboard access to the main content.

Checkout fields are editable as of Step 6. As of Step 7, Create order submits to the configured backend; Validate order (including Enter in a field) performs local checks only. Order search and details are connected as of Step 8. The Services screen is live as of Step 5 and makes read-only health/readiness requests; it does not submit orders or modify services.

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

The connection layer is implemented. The Services screen consumes its hooks as of Step 5; checkout submission and order lookup/details use them as of Steps 7–8. RTK Query owns server data, loading/error state, and cache invalidation. Zustand remains available for checkout drafts and local UI state. The Redux store is created per provider, not shared globally between server requests, and is not persisted.

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
- `markUncertain(key, message, retryAt?)` records an unknown outcome after a timeout/network failure. Draft changes and reset remain blocked. After any retry deadline, `retrySubmission()` returns the exact original normalized payload/key and moves back to `submitting`; it never generates a replacement key.
- `markSettled(key)` is for a definitive submission response or confirmed reconciliation. A known order accepted with 202 can settle the submission even while its saga continues running. Do not call it merely because a request timed out or returned an ambiguous infrastructure failure.
- `resetCheckout()` clears draft, key, request, error, receipt, and retry deadline only when idle/settled. A subsequent submission gets a new key. Callbacks with a different key are ignored. These primitives are connected to live checkout in Step 7.

Shipping addresses, customer IDs, item selections, request snapshots, keys, and submission errors are **never written to localStorage/sessionStorage**. They survive client-side navigation but not a full reload, tab close, or provider unmount. Do not reload an unresolved checkout expecting an automatic retry: this step does not promise duplicate prevention across reloads. Reconcile existing orders before starting a replacement checkout. The Step 7 UI explains this limitation and requests a browser reload/close warning while an outcome is unresolved.

### Hydration and persistence contract

The first server/browser render uses deterministic defaults with `hydration: "pending"`. A mount effect reads `saga:ui:v1`, restores allowlisted preferences, then marks hydration `ready`. History/preference mutations return `false` while hydration is pending, so a premature write cannot overwrite saved history. Navigation does not wait for storage.

Persisted format: `{ version: 1, state: { rememberRecentOrders, recentOrderIds } }`. IDs are validated UUIDs, normalized to lowercase, deduplicated, ordered most-recent-first, and capped at 20. Invalid JSON/versions fall back to defaults; unrecognized fields and any injected private data are discarded when this owned storage key is rewritten. Other storage keys are untouched.

`addRecentOrder`, `removeRecentOrder`, and `clearRecentOrders` manage the list. `setRememberRecentOrders(false)` clears remembered IDs and rejects new additions until enabled again. Step 8 exposes these actions in the recent-orders UI. It is not a server-side list of all orders.

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

## Step 7 — Submission and duplicate prevention

Open `/orders/new`, fill the demo checkout, and select **Create order**. This sends `POST /api/orders` through RTK Query and the Next proxy to the configured order service. Unlike **Validate order**, it can trigger backend payment, inventory, and shipping work. Run the backend prerequisites described above and configure the frontend's server-only service URLs for live use. Never point a demo checkout at production services unintentionally.

The store generates a secure UUID idempotency key on the first valid submission, synchronously locks the draft, and retains a frozen request snapshot. Double clicks cannot start a second request. There are no automatic mutation retries. **Retry original request** is available only after an uncertain outcome and uses the identical payload/key. Edits, resets, and new submissions are blocked while submitting or uncertain. A valid `Retry-After` header delays the explicit retry, enforced both in the UI and the store.

| Response | UI behavior |
| --- | --- |
| `200` / `201` with a correlated completed order | Show completion receipt and navigate to its order ID. |
| `202` with a correlated nonterminal order | Show accepted, still processing—not a completed purchase. |
| `422` with a correlated failed order | Record the saved order ID and show saga failure, not success. |
| `409` with a JSON error | Show idempotency conflict; no same-key retry or invented order ID. Verify the existing order before deliberately starting another checkout. |
| `400` with a JSON error | Show request rejection; start a new checkout to correct it. |
| `503`, network/timeout, malformed/unrelated replies, other failures | Treat outcome as uncertain: the backend may already have saved the order. Keep the request locked and offer same-key retry. |

Responses must pass the shared HTTP schema and match the request's customer, key, amount, currency, address, products, and quantities. Order/saga/item IDs and HTTP status must agree. Navigation is constructed from the validated UUID; untrusted `Location` headers are not followed. A bare/malformed `422` does not prove there is a failed order and is kept uncertain.

Successful correlation records the order ID in the browser's existing recent-history store, respecting opt-out and storage-unavailable behavior. Only IDs/preferences persist; drafts, delivery details, request keys, and receipts remain in memory. Completion updates the store even when the checkout page unmounts. It does not redirect users who navigated elsewhere; returning to checkout shows a **View submitted order** link. Settled checkouts stay locked until the user chooses **Start new checkout**, which clears their data and uses a new key on the next submission.

At the Step 7 milestone, `/orders/[orderId]` was a minimal submission-result destination. Step 8 now fetches order/participant details there. A matching in-memory submission receipt is shown separately and labeled as the original response; it never substitutes for the latest GET result. After reload the receipt disappears, but details are fetched again. Automatic polling remains Step 9.

**Lifetime limitation:** duplicate prevention is scoped to this tab's current in-memory checkout. A root-mounted `beforeunload` handler requests a browser warning while submitting/uncertain, including after client navigation, but browsers cannot guarantee this warning on close/crash. Reloading, closing, or opening another tab can lose the retry key and is not a safe retry mechanism. Keep the tab open until the outcome is known; if it is lost, reconcile with the backend before placing another order. No sensitive request payload is persisted to work around this limitation.

Tests cover state locking, same-key byte-for-byte retries, receipt correlation, `200/201/202/400/409/422/503`, timeouts, malformed responses, Retry-After, browser navigation, history opt-out, reload behavior, and desktop/mobile accessibility. The isolated API integration test exercises the actual browser → RTK mutation → production Next proxy → fixture backend path, including a `503` followed by an identical retry. It does not charge real providers or assert real PostgreSQL/RabbitMQ availability.

Verification on 2026-09-08: workspace typechecks, production build, and 118 checks passed (76 browser, 26 state/provider, 10 API, 5 component, 1 real-proxy integration). An initial integration assertion also matched Next's route announcer; alert selectors were scoped to main content and the check passed. The full 76-test browser run passed. Screenshot review then identified missing receipt-card spacing; it was corrected and all 8 affected desktop/mobile receipt tests passed again, including explicit padding and accessibility assertions. The real-proxy integration also passed against the final build. One final-build attempt was terminated during tracing; the subsequent build completed successfully. Desktop/mobile receipt and uncertain-retry screenshots were inspected. These results cover the frontend and isolated integration, not a real-provider purchase or guaranteed operation across tab close/crash.

## Step 8 — Order lookup and details

Use `/orders` to enter an order UUID. Surrounding whitespace and uppercase UUIDs are normalized before navigation. Invalid input shows an associated field error and receives focus; invalid detail URLs show a recovery link without making backend requests. These pages only read services; they do not retry saga operations, charge/refund, reserve/release, or create/cancel shipments.

The recent-orders section uses the existing Zustand UI store: up to 20 unique IDs, most recent first, recorded after verified lookup or submission. Open an ID, remove an entry, clear the list, or disable remembering entirely. Only IDs/preferences persist. Delivery details and API responses remain in memory. If browser storage is unavailable, the UI explains the in-memory fallback. A missing or unverified lookup does not add a new ID; existing saved IDs are not automatically deleted.

`/orders/[orderId]` reads `GET /orders/:id`, displays customer UUID, product IDs/quantities (seeded names where known), exact amount/currency, full shipping address, saga status/step/operation, compensation and intervention flags/reason, inventory-finalization state, and timestamps. There is no customer-profile or catalog-price API; the screen does not invent those details.

After verifying the order identity, the page independently reads payment, inventory reservation, and shipment GET endpoints. Each section has its own loading/error state and refresh button. It shows primary record status/IDs/provider references, stored operation results, and refund/cancellation records, including compensation-only rows. A documented participant `404` or a null primary record displays **Not started yet**, not a failure. An unavailable, malformed, or unrelated response displays an error instead; it is never interpreted as an absent record. Order/saga IDs, result identities, and reservation-item associations are checked before rendering.

Snapshots refresh on page entry and explicit **Refresh** clicks. While a verified saga remains active, the order snapshot also refreshes about every two seconds. The poller schedules the next request only after the prior request settles, cancels its timer/request on navigation, and relies on RTK Query's per-order request identity so an older response cannot replace a newer snapshot. It stops for `COMPLETED`, `FAILED`, and manual-intervention sagas; manual refresh remains available in all cases. Temporary transport/server failures retry less often. A later resume mutation invalidates and refreshes the order cache, causing polling to resume if the returned saga is active. Participant sections remain independently refreshable, so their timestamps can differ from the order snapshot; these are not one atomic cross-service snapshot.

An order-service `404` shows **Order not found** and prevents participant requests. Other order failures show a retryable error. Invalid detail IDs are rendered as an explicit invalid-ID screen; backend missing-order errors are shown inside the normal detail route rather than claiming the frontend HTTP document itself is a backend `404`.

The Step 7 receipt, when present, is explicitly historical and separate from the GET-based overview. Automatic polling is implemented in Step 9 below. Full transition history/progress and operational actions remain in Steps 10–11. Tests include lookup normalization, privacy/history controls, missing and mismatched records, partial failures, compensation-only data, intervention reasons, late-response isolation, responsive overflow, accessibility, and real Next-proxy GET integration with isolated fixtures.

Verification on 2026-09-08: workspace typechecks, final production build, 29 state/provider checks, 5 component checks, 10 API checks, and the isolated real-proxy integration check passed. All 16 new Step 8 desktop/mobile browser checks passed, including screenshots, accessibility and 320/768/1440px overflow checks. A subsequent result-label/badge readability adjustment was rebuilt successfully. Against that final build, the full browser run passed all 46 desktop checks and its first mobile checkout check, then was terminated (exit 143). The requested separate mobile rerun was not approved. Therefore the final full mobile regression pass is **not complete**, and the 92-test suite must not be reported as fully passed. To finish it when permitted, run `npm run test:e2e --workspace @saga/web -- --project=mobile`. Tests use isolated fixtures, not real purchases or real PostgreSQL/RabbitMQ availability.

## Step 6 — Checkout form and local validation

Run `npm run dev:web` and open `http://localhost:3004/orders/new`. **Validate order** needs no running backend. At the Step 6 milestone, Create order was disabled; Step 7 now enables live submission as described below. Entering a form, pressing Enter, validating, and clearing the draft do not send orders, charge payments, or reserve inventory. Validation does not generate an idempotency key or put the checkout into a submitting state.

The three choices match `services/inventory-service/src/db/seed.ts`: Demo Keyboard, Demo Mouse, and Demo Monitor. Displayed seed stock (100, 50, and 0 respectively) is historical initialization data, not live availability. Monitor remains selectable for the insufficient-stock demo. The browser does not import backend/database modules, and a test detects catalog drift from the seed file. There is no catalog-price API, so the amount is explicitly a manually entered **demo total**, not a product-derived price or quote.

### Fields and validation

- Customer ID must be a UUID. Selected products must have whole quantities from 1 through 10,000; at least one item is required.
- Currency is BDT or USD. Changing currency changes the currency code only; it does not perform exchange-rate conversion.
- Amounts use digits with an optional one/two-digit decimal fraction, such as `12`, `12.3`, or `12.30`. The supported range is `0.01` through `99999999.99`. Negative values, exponents, commas, trailing decimal points, zero, excessive precision, and out-of-range values are rejected rather than rounded. Enter `0.50`, not `.50`.
- Amount conversion splits the decimal string into whole/fractional integer parts, so `0.29` is exactly 29 minor units. The raw amount string stays in Zustand memory during edits/navigation; the numeric draft is `null` when that string is invalid.
- Shipping requires recipient, address line 1, city, postal code, and a two-uppercase-letter country code. Line 2 and region are optional; whitespace-only optional values are omitted from the validated payload. Customer UUIDs and country codes are normalized consistently. These checks match the backend contract; they do not verify that a customer, postal address, or product is operationally available.

Errors are linked to their fields and the first invalid control receives focus after validation. After an unsuccessful validation, errors update as fields are corrected. Editing any value clears the previous success announcement. The summary shows selected products/quantities, the demo total, exact minor units, and entered delivery details without inventing totals or stock guarantees.

The pure helpers in `src/lib/checkout/form.ts` validate the payload and build a complete shared-contract request when submission supplies an idempotency key. The checkout store uses the same normalization, so optional blank address fields cannot pass form validation and later fail solely because of different normalization.

Drafts, including raw amount text and private delivery fields, survive client-side navigation only. They are not written to localStorage or sessionStorage, and a full reload clears them. **Clear draft** resets the draft, amount text, and local feedback. Existing submission locks still protect an in-flight or uncertain checkout from editing.

### Checks

`npm run test:state --workspace @saga/web` includes seed parity, exact amount boundaries/round trips, invalid money formats, shared-schema request construction, address normalization, quantity/duplicate validation, and synchronized/locked/reset amount state. `npm run test:web` additionally runs desktop/mobile form checks for valid and invalid entries, error focus and accessibility, summaries, product selection, no writes, navigation persistence, reset, and reload clearing, alongside all prior regression suites. Backend acceptance and real order submission remain outside this step.

Verification on 2026-09-08: workspace typechecks, production build, 5 component checks, 20 state/provider checks, 10 API checks, 50 desktop/mobile Chromium checks, and 1 isolated real-proxy integration check passed across suite runs and targeted reruns (86 checks). Initial browser runs exposed ambiguous test selectors for required labels and the repeated checkout notice/footer; those selectors were corrected. The subsequent browser run passed 48 checks, and both remaining checkout layout checks passed with `npm run test:e2e --workspace @saga/web -- --last-failed`. Desktop/mobile checkout screenshots were reviewed; automated accessibility scans reported no violations in the tested states. This does not assert real PostgreSQL/RabbitMQ availability or live order acceptance.

## Step 9 — Automatic status polling

Order details refresh two seconds after each successful active-order GET. Initial network failures also retry: transport errors, HTTP 408/429, and server errors back off through 4, 8, 16, and 30 seconds; success resets the delay. Missing, malformed, and unrelated responses require manual refresh. Completed, failed, and intervention-required orders stop polling.

Initial loads, manual refresh, polling, and resume-triggered invalidation share RTK Query's per-order request deduplication. Leaving details clears the timer and aborts outstanding order and participant GETs. Cleanup tolerates React Strict Mode effect reconnection. Verified details and participant sections stay mounted during background refresh, avoiding flicker and repeated participant GETs. Each participant still has an independent manual refresh; its snapshot is not an atomic view of the saga.

The existing resume mutation invalidates the order cache. A newly fetched active snapshot starts polling again; the actual resume controls remain in Step 11. The API test exercises resume invalidation, and browser tests exercise polling restart from a refreshed active snapshot.

Verification on 2026-09-09: production build including TypeScript, 26 focused desktop/mobile browser tests, 13 API tests, 29 state/provider tests, and 5 UI tests passed. Tests cover initial recovery, retry delay reset/cap, deduplication, stable rendering, navigation cancellation, late-response isolation, terminal/intervention stops, and resume invalidation. These results use isolated fixtures, not real database/broker/provider execution.

To repeat the focused browser checks after a build, run `npm run test:e2e --workspace @saga/web -- orders.spec.ts polling.spec.ts`. If the default test port is occupied, use `PLAYWRIGHT_PORT=3114` as in this verification; the suite starts its own server and never reuses an existing one.
