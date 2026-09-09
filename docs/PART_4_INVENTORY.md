# Inventory service

Reserves stock during checkout, restores it during compensation, and finalizes successful sales.

| Endpoint | Purpose |
| --- | --- |
| `POST /inventory/reserve` | Reserve the requested items |
| `POST /inventory/release` | Release reserved stock |
| `POST /inventory/finalize` | Mark a reservation sold |
| `GET /inventory/reservations/:orderId` | Current reservation and items |

## Behavior

- Stock updates and reservation records commit atomically.
- Insufficient or missing stock rejects the reservation without a partial basket.
- Duplicate commands do not repeatedly subtract or restore stock.
- Released reservations cannot be reopened by late reserve commands.
- FINALIZED is terminal: releasing it is invalid.
- Command replay is historical; GET reports current state.
- Demo seeding never replenishes previously consumed stock.

**Check:** `npm run test:inventory`.
**Examples:** [Postman](../postman/README.md).
**Startup and health:** [runbook](PART_10_VALIDATION.md).
