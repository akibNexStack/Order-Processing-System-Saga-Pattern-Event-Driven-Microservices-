# Contracts and business rules

Shared Zod schemas and TypeScript types keep all four services consistent.

## Key rules

- Checkout supplies an idempotency key, customer UUID, items, amount, currency, and shipping address.
- Amounts are positive integer minor units: `12500` means 125.00 BDT or USD.
- Orders contain 1–100 distinct products with whole quantities of 1–10,000.
- Unknown fields and invalid identifiers are rejected.
- Reuse the same key and payload for retries. A conflicting payload is not a new valid request.
- Results distinguish success, confirmed failure, and UNKNOWN. A timeout is not proof of failure.
- Demo totals are client-provided; schema validation is not trusted pricing or customer authentication.

Source: [shared contracts](../shared/src/contracts.ts).
Examples: [Postman guide](../postman/README.md).

**Check:** `npm run check`.
