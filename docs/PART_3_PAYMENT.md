# Payment service

Handles simulated charges and full refunds. No real money moves.

| Endpoint | Purpose |
| --- | --- |
| `POST /payments/charge` | Charge a payment |
| `POST /payments/refund` | Refund or record a safe no-op |
| `GET /payments/:orderId` | Current payment and refund state |

## Behavior

- Commands use the [shared envelope](PART_1_CONTRACTS.md).
- Saved receipts and provider keys prevent duplicate effects.
- Replaying a command returns its historical result; GET shows current state.
- Refund-before-charge records compensation intent so a late charge cannot reopen the operation.
- UNKNOWN/202 requires reconciliation or an identical retry, not a new key.

`PAYMENT_SIMULATION_MODE` supports `success`, `reject`, and `timeout-after-success`. Change it on the server and restart/redeploy, not in the request.

**Check:** `npm run test:payment`.
**Examples:** [Postman](../postman/README.md).
**Startup and health:** [runbook](PART_10_VALIDATION.md).
