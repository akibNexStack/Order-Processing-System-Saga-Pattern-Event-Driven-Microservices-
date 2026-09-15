# Project presentation guide

Use this as a relaxed speaking guide for a live demo. Do not try to read every word exactly; use the flow and adapt it to what is visible on screen.

## Opening

> Hello everyone. Today I am presenting my Order Processing System. It is based on the Saga Pattern and event-driven microservices.
>
> The main idea is simple: placing an order is not only one database action. It involves payment, inventory, and shipping. In a real system, those can fail independently, so this project coordinates them safely.

> I built the frontend with Next.js. On the backend, Auth, Order, Payment, Inventory, and Shipping are separate services. PostgreSQL stores the data, and RabbitMQ carries messages between the services.

## 1. Overview dashboard

Open the home page.

> This is the workspace overview. It gives a quick picture of the system: service status, recent orders, and any orders that may need attention.
>
> One useful detail here is the difference between health and readiness. Health means a service is running. Readiness means it can also reach its required dependencies, such as PostgreSQL and RabbitMQ.

## 2. Registration and account access

Open **Create account**.

> Let me start as a normal customer. The user can register with a valid email address and a password of at least twelve characters.
>
> The system validates the input, hashes the password, creates a server-side session, and supports email verification and password reset. It also rate-limits login attempts and locks an account after repeated failed passwords.

After signing in, open **Account**.

> Here the user can see the account email and role. In this project, there are two roles: customer and administrator.

## 3. Customer experience and permissions

While signed in as a customer, show the navigation and order pages.

> As a customer, I can create orders and view only my own order history. I cannot see administrator payment approvals, and I cannot approve payments myself.

> This is enforced twice. The UI hides controls that are not relevant to customers, and the backend also returns a 403 Forbidden response if a customer tries an admin operation directly.

## 4. Create a Cash on Delivery order

Open **Create order**. Select an available product, enter delivery details, select **Cash on Delivery**, and submit.

> Now I will create a Cash on Delivery order. I select a product, set the quantity, add the shipping address, and submit it.

> After submission, the order enters the Saga workflow. The orchestrator coordinates Payment, Inventory, and Shipping as separate steps.

On the order-details page:

> For COD, the payment status is Pay on Delivery. There is no prepaid charge, so fulfillment can begin immediately. The system reserves inventory, creates shipping, and finally marks the order as completed.

Refresh the page.

> I can refresh the page and the order progress is still here. That is because the Saga state is stored in PostgreSQL; it is not only kept in browser memory.

## 5. Create a Bank Transfer order

Create another order and select **Bank Transfer**.

> Next, I will select Bank Transfer. This order behaves differently. It is accepted, but it stops at Pending Payment.

> This is intentional. The system does not reserve stock or create shipping until someone verifies that the bank transfer has really been received.

## 6. Administrator approval

Sign out and sign in with an administrator account. Open **Payment approvals**.

> Now I am signed in as an administrator. Notice that the Payment approvals menu is now visible. A normal customer cannot see this menu.

> This page lists bank-transfer orders that are waiting for review. After checking the transfer reference outside the application, the administrator can confirm payment.

Open the pending order and confirm it.

> After confirmation, the Saga continues. It processes payment, reserves the inventory, creates shipment information, and finishes the order.

## 7. Failure and compensation

Create an order using a product with no available stock.

> Let me also show a failure case. If an item is out of stock, the order cannot complete.

> The important part is that the system does not leave partial work behind. If an earlier prepaid payment succeeded but inventory later fails, the Saga performs compensation, such as refunding the payment and releasing any reserved stock.

> This is the key benefit of the Saga Pattern: each service keeps its own database, but the overall business process can still recover safely.

## 8. Order history and service status

Show an order’s history and then open **Services**.

> Every order includes a history of important events, so we can understand what happened and when. We can also inspect payment, inventory, and shipping records separately.

> On the Services page, we can check each backend service independently. This helps identify whether a problem is in the application, database, message broker, or a participant service.

## 9. Testing

Show the terminal and run the relevant commands.

> I also added automated tests. They cover payment behavior, including the difference between Cash on Delivery and Bank Transfer, authentication security, one-time verification tokens, authorization, idempotency, and Saga recovery behavior.

```sh
npm run test:payment
npm run test:auth
npm run test:api -w @saga/web
```

> The payment tests verify that a prepaid payment can move from Charged to Refunded when compensation is needed, while a COD payment remains Pay on Delivery and compensation is a safe no-op.

## Closing

> To summarize, this project demonstrates how to build a safer distributed order workflow. It handles separate services, asynchronous messages, retries, idempotency, failures, compensation, customer ownership, administrator approvals, and service monitoring.

> It is designed as a production-oriented learning project. Before a public production launch, the remaining release and deployment checks should be completed and verified.

## Recording tips

- Keep the demo to 5–8 minutes.
- Speak slowly and show one action at a time.
- Use a normal customer account first, then an administrator account.
- Prepare two products: one in stock and one with zero stock.
- Do not show passwords, database URLs, API tokens, or email verification tokens in the recording.
- If a service takes a moment to process, say: “The Saga is processing asynchronously, so I will refresh the order status.”
