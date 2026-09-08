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

- Allow selection of seeded demo products.
- Add inputs for quantity, customer ID, amount, and currency.
- Build the shipping address form.
- Validate input against the shared request contract.
- Display an order summary and field-level errors.
- Convert amounts correctly into integer minor units.
- Clearly identify the use of demo products and a demo amount input.

**Completion outcome:** The form can produce a valid order request for the backend.

## Step 7 — Implement Order Submission and Duplicate Prevention

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

- Allow users to search by order ID.
- Display recent orders recorded in the current browser.
- Show customer information, items, amount, and shipping address on the order details page.
- Display saga status, the current operation, and any intervention reason.
- Display results from the payment, reservation, and shipment GET endpoints.
- Show “Not started yet” when a participant record has not been created.
- Handle invalid IDs, missing orders, and partial service failures.

**Completion outcome:** Users can inspect an order's current state in one place.

## Step 9 — Implement Automatic Status Polling

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

- Create a progress component for payment, inventory reservation, shipment creation, and inventory finalization.
- Derive pending, running, succeeded, and failed states from backend data.
- Display compensation progress for refunds and inventory releases.
- Display events from the history endpoint in chronological order.
- Provide plain-language explanations of technical events, with raw details available when needed.

**Completion outcome:** Users can understand what happened to an order and why.

## Step 11 — Build Attention, Resume, and Overview Features

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
