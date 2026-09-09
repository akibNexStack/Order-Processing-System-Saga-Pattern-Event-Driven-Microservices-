# Free demo deployment: Vercel + Render + Neon + CloudAMQP

The default `render.yaml` creates **four Free web services only**. It creates no paid database, private service, or disk. The previous paid configuration is available separately as `render.paid.yaml`.

Free means staying within each provider's free allowances. This setup supports occasional demos; it cannot guarantee continuous background processing. Render's 750 free instance hours are shared across the workspace: all four services running together consume four hours per clock hour. Services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Background database polling also uses Neon compute and network allowances while services are running.

## 1. Create PostgreSQL databases on Neon Free

1. Sign up at https://neon.com and select the Free plan.
2. Create four projects: `saga-orders`, `saga-payment`, `saga-inventory`, and `saga-shipping`. Use a region close to the Render services; the Blueprint uses Singapore.
3. In each project, open the connection dialog and copy the **direct PostgreSQL connection string**, with connection pooling disabled. Keep the supplied TLS parameters.
4. Keep track of which connection string belongs to each service. Do not use the same database for all four: their schemas contain identically named tables with different ownership.

Direct connections are required for the application's session-level database locking. Do not substitute a transaction-pooling endpoint. These URLs contain credentials; enter them only in platform environment settings.

## 2. Create the RabbitMQ broker

1. Sign up at https://www.cloudamqp.com.
2. Choose the **RabbitMQ** product and the **Little Lemur — Free** plan. The application uses RabbitMQ quorum queues; the LavinMQ free offering is not a verified substitute.
3. Choose a nearby available region.
4. Copy the full TLS AMQP connection URL beginning with `amqps://`, including its username, password, hostname, and virtual-host path.
5. Use this same full URL for all four services. Do not remove or change its virtual-host path.

The listed Little Lemur allowances include 20 connections, 100 queues, and one million messages/month; idle queues can expire after 28 days. Confirm the chosen instance supports the application's quorum queues before relying on it. The hosted provider connection has not been tested in your account.

## 3. Push and deploy on Render

1. Commit the deployment changes and successfully push them to your GitHub repository.
2. From Render's dashboard, choose **New → Blueprint**.
3. Select the repository, branch `main`, and Blueprint path `render.yaml`.
4. Name the Blueprint `saga-order-system-free`.
5. For each service's `DATABASE_URL` prompt, paste its own Neon connection string.
6. For every service's `RABBITMQ_URL` prompt, paste the same CloudAMQP TLS AMQP URL.
7. Verify the preview lists exactly four web services with **Free** compute plans. If it shows paid databases, a private broker, or disks, the latest default Blueprint is not being used.
8. Review the provider's allowance/billing settings, then deploy.

Migrations run during startup, followed by the service process. No paid pre-deploy hook or dashboard shell is required. Inventory seeding is repeatable and preserves consumed stock. Failed migrations prevent the service from starting; inspect its logs and connection settings.

The Blueprint generates `BACKEND_API_TOKEN` in `saga-backend-auth` and applies it to all four services. Use that token in Postman and Vercel. Keep all services on the same `RABBITMQ_PREFIX`.

## 4. Wake and verify all four services

1. Copy the actual public URL from each Render service.
2. Before a demo, open `/health` on **each of the four URLs** and wait for JSON with status `ok`. An order request alone does not reliably wake sleeping participant services through RabbitMQ.
3. In Postman, set `orders_url`, `payment_url`, `inventory_url`, and `shipping_url`; set `backend_api_token` to the generated Render token.
4. Check each authenticated `/ready` returns 200. If it returns 503, inspect service logs and the database/broker configuration. A quorum-queue declaration error requires checking the selected broker's capabilities.
5. Create a demo order and verify it completes. If a service slept during processing, wake all four, read the saved state, and use Resume if intervention is required. Retry uncertain checkout submissions with the original key.

Do not use recurring keep-alive pings to try to keep all four running continuously on the shared free-hour allowance. Monitor usage in Render, Neon, and CloudAMQP; free-tier limits can suspend processing. Do not enable paid upgrades or overages if you require zero spending.

## 5. Connect Vercel

Use the Vercel settings in `DEPLOYMENT.md`: root `apps/web`, Node 24, source files outside the root included, and the four public Render origins plus the shared backend token in server-only environment variables.

After waking the services, refresh the Services page if an earlier request timed out. The frontend's 10-second proxy deadline can expire during a Render cold start; that alone does not mean an order failed.

The frontend access-protection choice remains separate from free hosting. The backend token does not restrict visitors who can access Vercel's API proxy.

## References

- Render Free limits: https://render.com/docs/free
- Neon Free allowances: https://neon.com/pricing
- CloudAMQP plans: https://www.cloudamqp.com/plans.html
