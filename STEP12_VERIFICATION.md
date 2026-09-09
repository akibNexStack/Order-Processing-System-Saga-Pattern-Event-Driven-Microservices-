# Step 12 verification — 2026-09-09

Target: Vercel frontend and Render backend, using simulated providers and fake demo data.

## Implemented

- Docker builds targeting Node 24; Render Blueprint and Vercel monorepo settings.
- Separate durable PostgreSQL databases and private persistent RabbitMQ.
- Per-service pre-deploy migrations and repeatable, non-replenishing inventory seed.
- Server-to-server authentication for Render business/readiness endpoints, with a server-only Vercel token.
- Idle database connection error handling in every service, verified by terminating actual idle connections and reconnecting.
- Correct pending compensation operation in the attention API.
- Real browser checkout through Next.js, four running services, PostgreSQL, and RabbitMQ.
- Reproducible release-check command, CI workflow, and [deployment runbook](DEPLOYMENT.md).

## Evidence

| Check | Result |
| --- | --- |
| Workspace type checks | Passed |
| Production frontend build | Passed locally and on Node 24 in Docker |
| Render backend Docker build | Passed on Node 24 |
| Render Blueprint official JSON Schema | Passed |
| Backend/database/messaging/recovery checks | 166 non-system checks passed |
| Full-stack browser and crash/outage system suite | 12 passed |
| Hosted service authentication regression | 1 passed |
| Exact Render migration entrypoint + database regressions | 22 passed (overlaps the backend count) |
| Frontend component/state/API checks | 5 + 36 + 15 passed |
| Live Next.js proxy integration | 1 passed |
| Desktop/mobile browser regressions | All 130 passed across the full run and targeted rerun |
| Production dependency audit | 0 vulnerabilities |

The initial backend run reached its 240-second system-suite limit with 175 passing checks and two cancellations (the parent and its final child). After increasing the system-suite budget, all 12 system checks passed, including the added real browser flow. Cancellations are not counted as passes.

The full browser run passed 129 tests in 12.6 minutes. The multi-page/four-width layout test hit its 45-second deadline during concurrent builds; its trace reported a timeout, not an overflow assertion. That matrix now uses Playwright's slow-test allowance with all assertions retained. Both desktop and mobile matrices passed in a separate one-worker rerun (15.8 and 15.1 seconds per test). The initial full report remains in `apps/web/playwright-report`; rerun artifacts were written separately to `/tmp/saga-layout.DCFSeE`.

In total, 179 backend/system/authentication checks and 187 frontend checks have passing results across these runs (366 distinct checks, using the test runners' counts). This is not a claim of one uninterrupted clean run. Workspace types were checked again after the test adjustment. The Render backend image runs as user `node`; the disposable system-test containers were confirmed removed. Existing development infrastructure was left running.

The real browser test proves response-loss retry reuses the original request/key and creates one durable order; successful checkout reaches COMPLETED with charged payment, finalized inventory and a created shipment; zero-stock checkout reaches FAILED after refund; reload reads saved state; terminal resume cannot restart work. Separate system and frontend suites cover pending work during broker outages, participant isolation, recovery, duplicate requests, mobile layouts, keyboard navigation and error states.

## Remaining release gates

- No resources have been provisioned on Vercel or Render, and no hosted smoke check has been performed.
- The earlier private-demo requirement still needs a confirmed frontend access-protection choice. The backend token alone does **not** protect public access through Vercel's proxy. Do not share an unprotected deployment.
- Render's Blueprint provisions paid resources; review charges before applying it.
- The full development dependency audit reports four moderate findings in the Drizzle Kit / esbuild development-tool chain. These are absent from the production dependency audit and pruned runtime images. A forced breaking tooling downgrade was not applied.
- This is not a public production commerce release: providers are simulated and individual authentication, authorization, authoritative pricing, abuse controls and high availability are out of scope.

Passing these tests is evidence for the covered flows, not a guarantee of perfect behavior under every deployment or failure condition.
