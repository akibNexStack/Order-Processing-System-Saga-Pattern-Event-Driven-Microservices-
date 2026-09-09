# Platform guide and frontend integration verification

## Scope

- Added `/features` and desktop/mobile navigation entry **Platform Features**.
- Described the actual checkout, status/history, participant snapshots, attention/resume, service checks, API-only commands, and demo limitations.
- Replaced the misleading deployment-independent “Local workspace” badge with “Demo workspace”.
- Added `.env.vercel.example` with the four public Render origins and a blank server-only token.
- Vercel now requires every backend origin explicitly instead of falling back to localhost when configuration is missing.

## Local checks

- Shared UI tests: 5 passed.
- API/client/proxy tests: 16 passed, including all 23 allowlisted backend endpoint shapes, correct four-service Render routing, token forwarding, and missing-origin rejection.
- State/checkout/recovery tests: 36 passed.
- Desktop/mobile Playwright suite: 132 passed, including accessibility, navigation, responsive layout, checkout, order lookup, history, participant records, service outages, resume, polling, and duplicate/uncertain submission handling.
- Next.js production compilation and TypeScript checks passed.
- Desktop and mobile guide screenshots inspected.

Browser/API tests use controlled responses, not authenticated calls to the hosted Render services. No live orders were created during these checks. These results are not proof of hosted end-to-end behavior or of every possible fault scenario.

## Remaining hosted release checks

1. Set all four origins and the real shared backend token privately in Vercel; redeploy.
2. Protect both frontend pages and API routes for the intended private demo. Server-to-server credentials do not authenticate visitors.
3. Wake all four Render services and confirm health and authenticated readiness.
4. Submit a fictional in-stock order, verify COMPLETED with matching participant states, then reload and inspect history.
5. Submit a separate out-of-stock demo order and verify compensation and FAILED.
6. Verify the guide, navigation, service status, lookup, and attention screens on the actual deployment.

Do not expose secrets, use real customer/payment information, or treat free sleeping services as an always-on production store.
