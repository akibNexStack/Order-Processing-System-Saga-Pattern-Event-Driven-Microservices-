# Manual API testing with Postman

Import **Saga-System.postman_collection.json** into Postman. It contains 170 requests across 14 folders, with request bodies, headers, variables, and response assertions. Optionally import **Local.postman_environment.json** and select **Saga System — Local**. The collection also works without an environment.

## Render environment

Import both **Saga-System.postman_collection.json** and **Render.postman_environment.json**, then select **Saga System — Render**. The environment supplies all four hosted URLs:

| Variable | URL |
| --- | --- |
| `orders_url` | `https://saga-orders.onrender.com` |
| `payment_url` | `https://saga-payment.onrender.com` |
| `inventory_url` | `https://saga-inventory.onrender.com` |
| `shipping_url` | `https://saga-shipping.onrender.com` |

Set the current value of `backend_api_token` in Postman to the generated `BACKEND_API_TOKEN` from Render's `saga-backend-auth` environment group. Do not export, commit, or share that value. The collection sends it as a Bearer token; hosted business routes and readiness calls require it.

Before running checkout scenarios, send all four `/health` requests in folder 01 individually to wake the Free services. Wait for each to return 200, then verify all four authenticated `/ready` requests return 200. Increase Postman's request timeout to 120000 ms if needed for cold starts. A public health response alone does not prove database or broker readiness. RabbitMQ messages do not wake sleeping participant services.

Run folders **01–09**, in order, with one iteration and both hosted simulation modes set to `success`. These tests create durable demo records and consume inventory; do not run against real customer data. Folders **10–13** require the corresponding Render service environment mode changes and redeploys described below, one scenario at a time. Folder **14** is manual diagnostics, not an automatic run-all test. Restore both simulation modes to `success` afterwards. For controlled broker/process outage tests, prefer the local disposable setup; the Docker stop instructions below do not apply to CloudAMQP.

The URL mapping and import artifacts are checked locally. This does not establish that every case passes on Render: hosted execution additionally requires your private token, ready services, available stock, and the scenario-specific server settings. Do not share the token with anyone or embed it in exported JSON.

## Start the project

From the project root, with the service `.env` files configured:

```bash
npm install
npm run infra:up
npm run migrate
npm run db:seed
npm run dev
```

Leave `npm run dev` running. The default URLs are orders `http://localhost:3000`, payment `http://localhost:3001`, inventory `http://localhost:3002`, and shipping `http://localhost:3003`. Change the corresponding `*_url` variables if necessary. Use the Postman desktop app or its Desktop Agent to reach localhost.

Both `PAYMENT_SIMULATION_MODE` and `SHIPPING_SIMULATION_MODE` must be `success` for the standard run. These settings belong in the corresponding service `.env` files; changing a Postman variable does not change the server. Restart the affected service after changing its mode.

## Standard run

1. Open the collection's Runner, select folders **01–09**, use **one iteration**, and run them in order.
2. Inspect the response body and **Test Results** for each request. Expected error responses such as 400, 409, 413, 415, and 422 are passing negative tests when they match the assertion.
3. To send requests individually, start each workflow at its first **NEW** request, then follow the remaining requests in order. Repeat the polling request until the order reaches the expected terminal state.

Every first workflow request generates fresh order/saga IDs and idempotency keys. Later requests reuse those collection variables. Sending a **NEW** request again starts another case; use the explicit **Replay** request to test duplicates. Do not put generated workflow variables in an environment, as environment values override collection values.

Polling repeats automatically only in Runner, CLI, or Newman. It waits 500 ms between responses, with at most 120 attempts by default (plus request time). Change `poll_delay_ms` and `poll_max_attempts` if needed. Unexpected terminal states, an intervention flag, and polling exhaustion fail the test and stop the run. A single Send does not automatically move to the next request.

| Folder | Coverage |
| --- | --- |
| 01 | All four health and readiness endpoints |
| 02 | Complete checkout, persisted participant states, history, duplicate checkout, conflicting payload, resume, attention list |
| 03 | Out-of-stock checkout, payment refund, terminal failure, no shipment, failed replay/resume |
| 04 | Charge/refund, replay, conflicting payload, late charge after compensation, refund-before-charge |
| 05 | Reserve/release, replay, conflicting payload, late reservation, release-before-reserve |
| 06 | Finalization, forbidden release, missing reservation/product, insufficient stock, mixed basket failure |
| 07 | Shipment creation/cancellation, replay, conflict, late creation, cancel-before-create |
| 08 | Invalid UUIDs and missing resources for all status/history/resume routes |
| 09 | Every command endpoint: malformed JSON, empty body object, unexpected fields, wrong content type, oversized body; order field boundaries and wrong participant operations |
| 10–13 | Optional provider rejection and ambiguous timeout scenarios |
| 14 | Manual attention/history/resume and broker outage diagnostics |

The stock seed creates a keyboard with 100 units, a mouse with 50, and a monitor with zero. The standard run permanently consumes **two keyboards**: one completed checkout and one directly finalized reservation. Direct reserve/release restores its unit. Re-running the seed **does not replenish existing stock**. Failed or interrupted runs can leave reservations; inspect their state and use the matching release request where applicable. Finalized inventory cannot be released. Use a disposable development database for repeated testing.

Request amounts are minor currency units: `12500` means BDT 125.00. Supported currencies are BDT and USD. Requests include a complete address example, including optional line2 and region. Direct participant requests do not create an orchestrator order; their IDs are deliberately separate. Payment and shipping providers simulate effects locally.

## Optional provider scenarios

These folders are skipped by default (`enabled_optional_folder=none`). Select and run **only one optional folder**, after configuring its server mode. If using the supplied environment, edit the variable in that environment.

| Folder / enabled_optional_folder | Server prerequisite | Expected result |
| --- | --- | --- |
| 10 | Payment mode `reject`; shipping `success` | Failed checkout before inventory; no completed steps |
| 11 | Shipping mode `reject`; payment `success` | Inventory released, payment refunded, order FAILED |
| 12 | Payment mode `timeout-after-success` | First charge/refund returns 202 UNKNOWN; identical retry reconciles to success |
| 13 | Shipping mode `timeout-after-success` | First create/cancel returns 202 UNKNOWN; identical retry reconciles to success |

Restore both modes to `success`, restart services, and reset `enabled_optional_folder=none` before another standard run. Historical forward-command replay can report CHARGED/CREATED/RESERVED even after compensation; the GET endpoint reports current persisted state.

## Manual outage and recovery investigation

Set `enabled_optional_folder=14` and use **Send individually**, rather than running this folder as an automatic scenario.

For a participant outage, stop one participant service while keeping the other services and RabbitMQ running. Send the create request in folder 02 once, copy the returned `order.id` into `recovery_order_id`, and inspect status/history in folder 14. While a command awaits a response, the order stays pending. After its bounded recovery attempts are exhausted it can appear in `/orders/attention`. Restore the participant, inspect state, and use resume if intervention is still required. Recovery may finish automatically before you press resume. Follow the resulting state to COMPLETED or fully compensated FAILED; a 202 response alone is not proof of completion.

For a broker outage, stop only RabbitMQ using your Docker tooling. Keep HTTP services running. The last two requests in folder 14 expect health 200 and readiness 503 with `checks.broker=false`. A new checkout can be durably accepted while publication is pending. Restore RabbitMQ and inspect the checkout until it finishes. Do not run the normal readiness assertions while deliberately testing an outage.

These HTTP requests cover every currently implemented route, but cannot prove all concurrency, database rollback, process-crash, or broker-redelivery properties. Use `npm run test:messaging`, `npm run test:recovery`, and `npm run test:system` for those controlled scenarios, or `npm run check:all` for the full project checks. See the Part 9 and Part 10 documents in `docs/` for recovery and fault-test details. There are no public product-management, restocking, authentication, or arbitrary order-cancellation endpoints in this project.

## Regenerate the JSON

```bash
node scripts/generate-postman.mjs
```

The generator is the source of truth for request bodies and assertions. It does not contact services. The files use the [Postman Collection v2.1 format](https://schema.postman.com/). Automatic polling uses [Postman's workflow controls](https://learning.postman.com/docs/tests-and-scripts/running-collections/building-workflows).

## Verification of this collection

Validated against the official Postman v2.1 JSON schema. All 262 embedded scripts compile, all template variables resolve, and the 34 positive request bodies match the project's contracts. Newman executed folders 01–09 and the correctly configured optional folders 10–13 against independent service processes, temporary PostgreSQL databases, and an isolated RabbitMQ queue prefix: **397 assertions passed, zero failures**. Polling counts can vary with timing. Test processes, databases, and queues were removed afterwards. Folder 14 contains manual diagnostics and was not executed as an outage test during this collection verification.
