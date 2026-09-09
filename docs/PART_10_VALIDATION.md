# Startup, testing, and troubleshooting

Use Node.js 24, npm, and Docker with Compose. Payment and shipping are simulations; use fictional data.

## Local startup

From the repository root, run `npm ci`. Copy each service's `.env.example` to `.env` only if that file does not already exist, then:

```bash
npm run infra:up
npm run migrate
npm run db:seed
npm run dev:all
```

Frontend: `http://localhost:3004`. Backend ports: orders 3000, payment 3001, inventory 3002, shipping 3003. Seeding does not replenish existing stock.

## Demonstrate the workflow

1. Open Services and confirm all four services are ready.
2. Create a demo keyboard order and follow it to COMPLETED.
3. Inspect its payment, reservation/finalization, shipment, and history.
4. Create a demo monitor order (initial stock zero); verify compensation and FAILED.
5. Use Attention and Resume only when recovery needs intervention.

For complete request bodies and optional failure modes, use [Postman](../postman/README.md). Never retry an uncertain checkout with a new key.

## Tests

| Command | Coverage |
| --- | --- |
| `npm run check:all` | Shared contracts, databases, services, messaging, recovery, and system tests |
| `npm run test:web` | Frontend components, state, proxy, and desktop/mobile browser tests |
| `npm run verify:release` | Combined release checks, including real-stack browser scenarios |
| `npm run test:system` | Focused full-stack behavior |

Database/broker tests need Docker and disposable infrastructure. Browser tests need Chromium; install with `npm exec --workspace @saga/web -- playwright install chromium`. Do not run destructive fault scenarios against valuable data.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| 401 from hosted API | Shared Bearer token matches all four services |
| Missing tables | Correct database URL and completed migrations |
| Health works, readiness fails | Database, RabbitMQ, consumer, and recovery readiness |
| Pending order | All participants awake; inspect history and broker connectivity |
| Insufficient stock | Demo inventory was consumed; seeding does not reset it |
| Frontend cannot connect | All four server-only origins and token configured; redeploy after changes |

`npm run infra:down` stops local infrastructure while preserving volumes.

## Hosting

Follow [Vercel/Render configuration](../DEPLOYMENT.md). Local tests do not prove hosted readiness. Protect frontend pages and API routes for a private demo, then verify successful checkout, compensation, and reload/history on the live deployment.
