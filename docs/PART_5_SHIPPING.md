# Shipping service

Simulates shipment creation and cancellation. No physical delivery is booked.

| Endpoint | Purpose |
| --- | --- |
| `POST /shipments/create` | Create a shipment |
| `POST /shipments/cancel` | Cancel an eligible shipment or record a no-op |
| `GET /shipments/:orderId` | Current shipment and cancellation state |

## Behavior

- Commands use the [shared envelope](PART_1_CONTRACTS.md).
- Receipts and stable provider keys prevent duplicate bookings.
- Cancellation-before-create prevents a late command from creating the shipment.
- Cancellation eligibility is checked; it is not arbitrary order cancellation.
- UNKNOWN/202 means the outcome needs reconciliation.
- Command replay returns its historical result; GET reports current state.

`SHIPPING_SIMULATION_MODE` supports `success`, `reject`, and `timeout-after-success`. Change it on the server and restart/redeploy.

**Check:** `npm run test:shipping`.
**Examples:** [Postman](../postman/README.md).
**Startup and health:** [runbook](PART_10_VALIDATION.md).
