# Saga Order System — User Guide

## 1. What the platform does

The platform demonstrates a checkout that spans four independent services: orders, payment, inventory, and shipping. You submit one order; the backend coordinates the work and the interface shows its progress and recorded results.

A successful checkout charges a **simulated** payment, reserves inventory, creates a **simulated** shipment, and finalizes the inventory reservation. If a later operation is rejected, the backend attempts the appropriate cleanup, such as releasing stock and refunding payment. This cleanup is called **compensation**.

No real money is charged and no physical delivery is arranged. Use fictional customer and delivery information. This is a demo workspace, not a production store.

## 2. Open the application

### Hosted demo

Open the **frontend URL supplied by the project owner**. The four Render service URLs are backend APIs, not the user interface. If the demo is access-protected, ask its owner for access; you should not need the backend API token to use the browser interface.

The project owner must configure the frontend before use. Follow the [deployment guide](../DEPLOYMENT.md) if you are responsible for hosting. Do not assume a frontend has been deployed merely because backend URLs exist.

### Local application

Follow the [local startup guide](PART_10_VALIDATION.md), then open `http://localhost:3004`. Normal users do not need to run database commands when using an already hosted application.

### Before creating an order

1. Open **Services** from the navigation. On a phone, use **Open navigation** first.
2. Select **Refresh all services** and wait for the checks to finish.
3. Confirm orders, payment, inventory, and shipping are all **Ready**.
4. If a service is unavailable, wait and refresh. Contact the project owner if it remains unavailable.

Health indicates that a service responds. Readiness indicates that its required dependencies are available. A responding service can still be unready. Free-hosted services may sleep; a timeout during wake-up does not prove an order failed. The owner may need to wake all four backend services separately.

## 3. Find your way around

| Section | What you can do |
| --- | --- |
| **Overview** | See readiness, orders needing attention, and recent order IDs from this browser |
| **Platform Features** | Read the in-app explanation of capabilities, workflow, and limitations |
| **Create Order** | Enter and validate a demo checkout, then submit it |
| **Orders** | Look up an order by ID and manage browser-local recent history |
| **Order details** | Inspect progress, payment, inventory, shipment, history, and recovery controls |
| **Attention** | Find orders that require intervention; the response contains at most 100 records |
| **Services** | Check each backend independently and refresh its health/readiness results |

## 4. Create your first order

Use this example after all services are ready and demo stock is available.

1. Open **Create Order**.
2. Enter the following fictional details. Select **Demo Keyboard** with quantity **1**.

   | Field | Example |
   | --- | --- |
   | Customer ID | `33333333-3333-4333-8333-333333333333` |
   | Amount | `125.00` |
   | Currency | `BDT` |
   | Recipient | `Demo Customer` |
   | Address line 1 | `10 Test Road` |
   | City | `Dhaka` |
   | Postal code | `1207` |
   | Country code | `BD` |

   Address line 2 and region are optional. Customer ID is a UUID for the demo, not a login or verified customer account.

3. Review **Order summary**. The amount is a manually entered demo total, not a calculated product price. `125.00` in the form becomes `12500` minor units in the API.
4. Click **Validate order**. Correct any highlighted fields. This action—and pressing Enter in a field—does **not** create an order.
5. Click **Create order** once. Wait for the response; do not start a replacement checkout while the outcome is uncertain.
6. On the resulting order page, save the **order ID** or bookmark the page. The submission receipt records acceptance, not necessarily completion.
7. Follow the order until it reaches a terminal state. For this successful example, expect **COMPLETED**, a charged payment, finalized inventory, and a created shipment.

The demo product choices reflect initial seed data, not guaranteed current stock. Successful orders permanently consume stock. If the keyboard is unavailable, inspect the failed order rather than repeatedly submitting it.

### Input rules

- Select at least one product with a positive whole-number quantity.
- Use a valid UUID for Customer ID.
- Amount must be positive with at most two decimal places. Enter `125.00`, not `125,00` or a value with a currency symbol.
- Currency is BDT or USD; changing it does not convert the amount.
- Complete the required address fields and use a two-letter country code such as `BD`.
- **Clear draft** removes an editable draft. After a settled submission, **Start new checkout** begins a separate order with a new retry identity.

## 5. Understand order status

| Status or message | Meaning | What to do |
| --- | --- | --- |
| **IN_PROGRESS** | Some processing is still pending | Keep the order page open and follow progress |
| **COMPENSATING** | The system is undoing earlier confirmed effects | Wait and inspect cleanup progress/history |
| **COMPLETED** | The checkout workflow finished successfully | Review participant states and keep the order ID |
| **FAILED** | The workflow ended unsuccessfully after required cleanup | Read the reason and compensation results before starting another order |
| **Intervention required** | Automatic processing needs assistance; this is not a separate terminal status | Follow the recovery steps below |
| **Not started yet** in a participant panel | No corresponding record has been reported for that operation | Compare with saga progress; it does not mean the service is unavailable |
| **Unknown**, unavailable, or an error | The current result could not be verified | Refresh or contact the owner; do not interpret it as success |

Active orders refresh automatically. Completed, failed, and intervention-required orders stop automatic polling; manual refresh remains available. Participant and history panels can update at different times because they are independent snapshots.

## 6. Find an order and inspect its history

1. Open **Orders**.
2. Paste the saved UUID into **Order ID** and click **Find order**.
3. Review the order, saga progress, and payment/inventory/shipment panels.
4. Read the event history to understand which steps completed, failed, or were compensated. Expand event details when you need the recorded technical information.
5. Refresh an individual panel if it reports an error; one unavailable service does not necessarily invalidate the other panels.

**Recent orders** is not a complete list of all server orders. It stores up to 20 recent IDs in this browser. Turning off **Remember recent orders in this browser**, removing an ID, or clearing the list does not delete backend orders. Keep important IDs separately if you use another browser or device.

## 7. Handle a timeout safely

If checkout reports an uncertain result:

1. Keep the current tab open. The backend might already have accepted the order.
2. Wait for any displayed retry countdown.
3. Use **Retry original request** when offered. It sends the same payload and idempotency key, allowing the backend to identify the original attempt.
4. Do not edit the request or create another checkout as a substitute for that retry.
5. If you already have an order ID, inspect its status before doing anything else.

Drafts and retry keys are held in memory, not permanent browser storage. Reloading, closing the tab, or switching devices can lose them. If that happens before an outcome is known, ask the project owner to reconcile the existing order before submitting a replacement. The interface cannot guarantee duplicate prevention across a lost browser session.

## 8. Recover an interrupted order

This task is for the person operating the demo, not a routine checkout step.

1. Open **Attention** and select the affected order.
2. Read the intervention reason and event history.
3. Check **Services**. Ask the owner to restore any failed service, database, or broker; the frontend cannot repair these dependencies.
4. Return to the unfinished order and click **Resume order** when available.
5. Wait for the result, then follow progress to COMPLETED or fully compensated FAILED.

A resume acceptance does not guarantee completion. If its outcome cannot be confirmed, refresh and inspect state before another attempt. Terminal orders do not offer Resume. Do not send competing manual refund, reservation, or shipment commands against an active checkout.

## 9. Demonstrate an expected failure

To show how compensation works, create a separate order containing **Demo Monitor** with quantity 1. Its initial demo stock is zero.

Expected outcome: payment succeeds first, inventory rejects the reservation, payment is refunded, and the order reaches **FAILED**. No shipment should be created. Verify the stored states and history rather than treating the initial submission response as the final result.

This scenario assumes the demo inventory has not been changed and both provider simulation modes are configured for success. More advanced rejection/timeout scenarios are operator-controlled through server settings and the [Postman guide](../postman/README.md), not switches in the frontend.

## 10. Troubleshooting and reporting a problem

| Problem | Recommended action |
| --- | --- |
| Validation errors | Correct the highlighted fields; validation alone sends no checkout |
| Order not found | Check the UUID and confirm you are using the correct deployment |
| Services remain unavailable | Refresh after wake-up; ask the owner to check backend configuration and logs |
| Order stays pending | Check all four services and history; do not submit a duplicate checkout |
| Recent order missing | Use its saved ID; browser history is local and optional |
| Insufficient stock | Inspect current results; restarting or reseeding does not replenish consumed stock |
| Unauthorized/API configuration error | Ask the owner to check the frontend's private backend configuration |
| Cannot cancel or restock in the UI | These are not supported user workflows |

When requesting help, provide the order ID, approximate time and timezone, page used, and visible error. Redact customer information, database URLs, RabbitMQ credentials, and API tokens from screenshots and logs.

## 11. Before presenting the project

- Confirm the frontend and all four backend services are available and ready.
- Use fictional data and verify that enough demo stock remains.
- Demonstrate one successful order, its history, and one out-of-stock compensation case.
- Show **Platform Features**, **Services**, and order lookup on desktop or mobile.
- Explain that providers are simulated, free services can sleep, and local test results are not proof of uninterrupted hosted operation.
- Ensure private-demo access protects both frontend pages and API routes. A backend token alone does not restrict frontend visitors.
