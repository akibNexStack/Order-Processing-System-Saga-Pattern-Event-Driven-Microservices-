# Databases and migrations

Each service owns a separate PostgreSQL database. Drizzle manages schemas and migrations; there are no cross-service foreign keys.

| Owner | Main records |
| --- | --- |
| Orders | Orders, items, saga state, transition history |
| Payment | Payments, refunds, command receipts |
| Inventory | Products, reservations, reservation items, command receipts |
| Shipping | Shipments, cancellations, command receipts |
| All services | Message outbox and inbox |

## Usage

After configuring service environments, run from the repository root:

```bash
npm run infra:up
npm run migrate
npm run db:seed
```

- Seed products: keyboard 100 units, mouse 50, monitor 0.
- Seeding inserts missing products; it does not replenish consumed stock.
- Keep generated migration SQL and metadata in Git.
- Use direct database connections where session-level locks are required.
- `npm run infra:down` preserves volumes. Do not delete volumes to repair a deployment.

**Check:** `npm run test:db`. See the [runbook](PART_10_VALIDATION.md).
