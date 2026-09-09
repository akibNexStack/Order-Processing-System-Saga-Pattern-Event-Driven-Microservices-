# Frontend Implementation Plan

Build a Next.js App Router frontend with TypeScript, RTK Query for server data, Zustand for local UI state, and Tailwind CSS for the existing order-processing microservices.

The implementation is divided into 12 steps. The first version will use the existing microservice APIs. Features requiring new backend capabilities will remain separate follow-up work.

## Step 1 — Set Up the Next.js Project

**Status:** Implemented in `apps/web`. See [frontend setup instructions](apps/web/README.md). Workspace typechecks and the Webpack production build passed; the development page returned HTTP 200 on port 3004.

- Create the Next.js App Router application with TypeScript in `apps/web`.
- Add the frontend to the root npm workspace configuration.
- Add Tailwind CSS, Zustand, and the required dependencies.
- Run the frontend on port `3004`.
- Create scripts to run the frontend independently and alongside the backend.

**Completion outcome:** The frontend runs at `http://localhost:3004`.

## Step 2 — Build the Application Layout and Navigation

**Status:** Implemented and verified. All five routes share a responsive sidebar, header, main content area, and mobile navigation drawer. Reusable UI primitives and loading, error, and not-found states are included. Workspace typechecks, the production build, 5 component checks, and 22 desktop/mobile Chromium browser checks passed. The browser checks cover navigation, focus handling, responsive overflow, and automated accessibility scans. See [verification details](apps/web/README.md#verification-result). The screens explicitly show that live data and order actions are not connected yet; screen integration remains in later steps.

- Create the sidebar, header, and main content layout.
- Add navigation for Overview, Create Order, Orders, Attention, and Services.
- Implement mobile navigation and responsive layouts.
- Create reusable buttons, inputs, cards, status badges, loading indicators, and error components.

**Completion outcome:** All screens have a working layout and navigation structure.

## Step 3 — Build the Backend Connection Layer

**Status:** Implemented with RTK Query, a per-provider Redux store, shared browser-safe contracts, and an allowlisted Next.js proxy for all 23 existing HTTP endpoint shapes. See [connection-layer documentation and test commands](apps/web/README.md#step-3--backend-connection-and-rtk-query). Screen integration and live infrastructure verification remain separate from this connection-layer step.

- Store the four service URLs in server-only environment variables.
- Use Next.js Route Handlers to proxy specific backend endpoints.
- Create typed API functions for the client.
- Preserve backend HTTP status codes, response bodies, and the `Retry-After` header.
- Handle timeouts, invalid responses, and unavailable services.
- Disable caching for live status responses.

**Completion outcome:** Browser requests reach the microservices through Next.js.

RTK Query is used for typed queries/mutations and server-data caching, as requested. HTTP responses remain uncached; RTK subscriptions share in-memory data and support explicit refetch/polling.

## Step 4 — Implement Zustand Stores and State Lifecycles

**Status:** Implemented. Per-provider `checkoutStore` and `uiStore` are mounted at the root layout. Navigation uses Zustand; checkout drafts and immutable retry snapshots remain in memory. Only validated recent order IDs and the remember-history preference are persisted after hydration. Server data remains exclusively in RTK Query. See [state-layer documentation](apps/web/README.md#step-4--zustand-state-and-lifecycles) for usage, checks, and reload limitations. Checkout forms, live submission, and the recent-order screen remain in Steps 6–8.

**Verification:** Workspace typechecks, production build, and all 60 automated checks passed: 14 state/provider tests, 30 browser tests, 10 API tests, 5 component tests, and 1 isolated API integration test.

- Create `checkoutStore` for selected items, form drafts, the idempotency key, and submission state.
- Use Step 3's RTK Query cache for order details, history, participant status, health/readiness, and request state; do not duplicate this server data in Zustand.
- Create `uiStore` for navigation state and UI preferences.
- Implement the store provider and hydration handling.
- Persist recent order IDs and necessary UI preferences.
- Do not persist shipping addresses in browser storage by default.

**Completion outcome:** UI state and data retrieved from the server are managed consistently.

## Step 5 — Build the Service Status Screen

**Status:** Implemented at `/services` with independent RTK Query health/readiness requests for all four services, separate dependency results, last-check timestamps, per-service refresh, and refresh-all. Loading, unready, unavailable, invalid-response, and missing-check states are distinguished; failed refreshes never leave old success results displayed as current. See [service-screen documentation](apps/web/README.md#step-5--live-service-status).

**Verification:** Workspace typechecks, production build, and 72 checks passed: 42 desktop/mobile browser checks, 14 state/provider checks, 10 API checks, 5 component checks, and 1 real-proxy integration check. The integration fixture deadline was adjusted from 100 ms to 1000 ms for the eight-request burst, then successfully rerun; its explicit timeout assertion remains in place. Desktop/mobile screenshots were reviewed. Real PostgreSQL/RabbitMQ availability was not asserted.

- Display `/health` and `/ready` results for all four services.
- Show database, broker, and order recovery status separately.
- Display loading states, unavailable states, and the last-checked time.
- Add manual refresh.
- Continue displaying results from available services when another service fails.

**Completion outcome:** Infrastructure problems can be identified from the frontend.

## Step 6 — Build the Create Order Form

**Status:** Implemented at `/orders/new`: seeded demo-product selection, quantities, customer ID, manual BDT/USD amount, shipping address, local summary, and shared-contract validation with field errors. Decimal strings convert exactly to integer minor units. “Validate order” performs local validation only; “Create order” stays disabled until Step 7. Drafts remain memory-only. See [checkout documentation](apps/web/README.md#step-6--checkout-form-and-local-validation).

**Verification:** Workspace typechecks and the production build passed. All 86 checks passed across suite runs and targeted reruns: 50 desktop/mobile browser checks, 20 state/provider checks, 10 API checks, 5 component checks, and 1 isolated real-proxy integration check. Ambiguous browser-test selectors were corrected; the final two checkout layout checks passed on rerun. Desktop/mobile checkout screenshots were reviewed. Real order submission and backend acceptance are Step 7 work, not verified here.

- Allow selection of seeded demo products.
- Add inputs for quantity, customer ID, amount, and currency.
- Build the shipping address form.
- Validate input against the shared request contract.
- Display an order summary and field-level errors.
- Convert amounts correctly into integer minor units.
- Clearly identify the use of demo products and a demo amount input.

**Completion outcome:** The form can produce a valid order request for the backend.

## Step 7 — Implement Order Submission and Duplicate Prevention

**Status:** Implemented: RTK Query submission, a synchronous checkout lock, secure per-checkout keys, immutable same-key retries, response correlation, truthful status feedback, recent-order IDs, and navigation to a minimal `/orders/[orderId]` receipt page. Full order details and polling remain Steps 8–9. Retry state is memory-only; reload/close is not a safe retry mechanism. See [submission documentation](apps/web/README.md#step-7--submission-and-duplicate-prevention).

**Verification:** Workspace typechecks, the final production build, and all 118 checks passed across suites: 76 desktop/mobile browser checks, 26 state/provider checks, 10 API checks, 5 component checks, and 1 isolated real-proxy integration check. After screenshot review, receipt spacing was corrected; all 8 affected desktop/mobile receipt checks and the proxy integration check passed again against the final build. Screenshots and automated accessibility checks were reviewed. Real PostgreSQL/RabbitMQ/provider execution was not tested.

- Generate an idempotency key for each new checkout.
- Integrate `POST /orders`.
- Prevent duplicate clicks while submission is in progress.
- Retry network failures using the same request and idempotency key.
- Prevent reuse of the same key with a modified payload while the original request's outcome is uncertain.
- Read the order ID from the response and navigate to the details page.
- Provide appropriate feedback for `202`, `409`, `422`, and `503` responses.
- Save the order ID in the recent orders list.

**Completion outcome:** Users can submit orders through the UI with duplicate prevention and safe retry behavior.

## Step 8 — Build Order Lookup and Details Screens

**Status:** Implemented at `/orders` and `/orders/[orderId]`: validated UUID lookup, recent-history controls, order/customer/items/amount/address and saga information, plus independently refreshable participant records and results. Missing records, partial service failures, identity mismatches, and invalid IDs have explicit states. Original submission receipts remain separately labeled. Automatic polling and full history/operations stay in later steps. See [details documentation](apps/web/README.md#step-8--order-lookup-and-details).

**Verification:** Workspace typechecks, final production build, 29 state/provider tests, 5 component tests, 10 API tests, and the isolated real-proxy integration test passed. All 16 new Step 8 desktop/mobile browser tests passed before a minor result-label/badge readability adjustment. On the final build, all 46 desktop regression tests and the first mobile checkout test passed; the long run then exited with signal 143. Permission to rerun the mobile project was declined, so the final full mobile regression pass remains incomplete. Desktop/mobile screenshots and accessibility checks for the new screens were reviewed. Real database/broker/provider execution was not tested.

- Allow users to search by order ID.
- Display recent orders recorded in the current browser.
- Show customer information, items, amount, and shipping address on the order details page.
- Display saga status, the current operation, and any intervention reason.
- Display results from the payment, reservation, and shipment GET endpoints.
- Show “Not started yet” when a participant record has not been created.
- Handle invalid IDs, missing orders, and partial service failures.

**Completion outcome:** Users can inspect an order's current state in one place.

## Step 9 — Implement Automatic Status Polling

**Status:** Implemented on `/orders/[orderId]`: active, verified order snapshots are refreshed about every two seconds by a self-scheduling request. Polls never overlap; pending requests and timers are cancelled on navigation. Terminal and intervention-required sagas stop automatically, while the existing manual refresh stays available. Temporary transport/server failures use a longer retry cadence. RTK Query keeps the per-order cache request-safe, and a later resume invalidation restarts polling if the returned saga remains active.

**Verification (2026-09-09):** Production build (including TypeScript) passed. All 26 focused desktop/mobile order and polling browser tests, 13 API tests, 29 state/provider tests, and 5 UI tests passed. Coverage includes initial temporary failure retries, backoff reset and cap, no overlapping GETs, stable details during refresh, initial/manual request cancellation on navigation, stale-response isolation, terminal/intervention stops, and resume-mutation invalidation restoring polling eligibility. These checks use isolated fixtures; real PostgreSQL/RabbitMQ/provider execution was not tested. Resume controls remain Step 11.

- Refresh active order status approximately every two seconds.
- Prevent overlapping requests for the same order.
- Clean up requests and timers when leaving the page.
- Prevent older responses from overwriting newer state.
- Stop polling when the order reaches `COMPLETED` or `FAILED`.
- Stop automatic polling when manual intervention is required and retain manual refresh.
- Increase the retry interval during temporary network failures.
- Restart polling after a resume action when the order remains active.

**Completion outcome:** Users can follow order progress without reloading the page.

## Step 10 — Build Saga Progress and History Views

**Status:** Implemented on order details. Four forward-operation rows derive progress from the saga's committed steps, finalization flag, current operation, and correlated result. Compensation follows the reverse cursor, preserving the failed forward operation. History loads from its GET endpoint in committed sequence order, with plain-language event explanations and expandable raw API records. It refreshes on saga version changes, has independent error/manual-refresh states, rejects wrong-order or duplicate-sequence history, and participates in navigation cancellation.

**Verification (2026-09-09):** Production build and TypeScript passed. All 32 focused desktop/mobile history, order, and polling browser tests, 34 state/provider tests, 13 API tests, and the isolated production Next-proxy integration test passed. New checks cover separate inventory finalization, compensation ordering, uncertain/failed outcomes, history sorting and identity, partial failures, final-transition refresh, history request cancellation, accessibility, and responsive overflow. Real PostgreSQL/RabbitMQ/provider execution was not tested.

- Create a progress component for payment, inventory reservation, shipment creation, and inventory finalization.
- Derive pending, running, succeeded, and failed states from backend data.
- Display compensation progress for refunds and inventory releases.
- Display events from the history endpoint in chronological order.
- Provide plain-language explanations of technical events, with raw details available when needed.

**Completion outcome:** Users can understand what happened to an order and why.

## Step 11 — Build Attention, Resume, and Overview Features

**Status:** Implemented: live attention queue with reasons, recorded operations, timestamps, order/history links, and explicit 100-record cap; shared per-order resume state with duplicate-click protection, validated outcomes, version-safe cache updates, and terminal controls hidden; live overview with independent readiness, attention, and browser-local recent orders. Final verification results are recorded in the frontend README.

**Verification (2026-09-09):** Final production build including TypeScript passed. All 186 checks passed: the full 130-test desktop/mobile browser suite, 36 state/provider tests, 14 API tests, 5 UI tests, and 1 isolated production-proxy integration test. Coverage includes all existing frontend sections and new attention/overview/resume flows, normal and uncertain outcomes, duplicate prevention across navigation, stale GET protection, terminal controls, polling restart, history links, accessibility, and responsive layouts. Final desktop/mobile overview screenshots were reviewed. Real PostgreSQL/RabbitMQ/provider execution remains outside this fixture-based verification.

- Display orders requiring intervention from `/orders/attention`.
- Show each order's reason, current operation, and last update.
- Provide actions to open order details and history.
- Prevent duplicate resume actions while a resume request is in progress.
- Refresh state according to the resume response.
- Hide the resume action for terminal orders.
- Show service readiness, the attention list, and the current browser's recent orders on the overview screen.
- Clearly communicate the attention endpoint's maximum of 100 returned records.

**Completion outcome:** Users can inspect problematic orders and resume unfinished work.

## Step 12 — Verify the Frontend and Prepare the Handoff

Verify the following important flows:

| Test | Expected result |
| --- | --- |
| Successful order | Order reaches `COMPLETED`, payment is charged, inventory is finalized, and shipment is created. |
| Insufficient stock | Order reaches `FAILED` after the refund completes. |
| Duplicate submission | The same checkout does not create a duplicate order. |
| Lost submission response | Retrying with the same key retrieves the original order. |
| Broker unavailable | An accepted order appears pending, and the readiness failure is visible. |
| Participant service unavailable | Other information remains visible, while the affected section shows an unavailable state. |
| Page refresh | The latest order state is retrieved again using the order URL. |
| Resume | Unfinished work can advance; terminal orders are not restarted. |
| Mobile and keyboard navigation | Forms, navigation, and actions remain usable. |

Then run the production build, type checks, and appropriate automated tests. Document setup and usage instructions.

**Completion outcome:** The first frontend version is ready to use and review.

## Implementation Order

Setup → Layout → API Layer → Zustand → Service Status → Checkout → Submission → Order Details → Polling → History → Operations → Verification

## Scope of the First Version

The first version will let users create an order and follow its success, failure, compensation, and recovery through the UI.

Product management, a server-side list of all orders, login, server-side pricing, and full order cancellation are outside this version. These features require backend extensions.
