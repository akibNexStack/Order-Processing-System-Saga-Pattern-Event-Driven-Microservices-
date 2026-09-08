# Saga frontend

Next.js App Router workspace for the order-processing microservices. Steps 1–2 provide the application foundation, responsive shell, navigation, and shared UI components. API integration and Zustand stores belong to later steps.

Run commands from the repository root after installing dependencies with `npm ci`:

```bash
# Frontend only; infrastructure is not needed for the layout preview.
npm run dev:web
```

Open http://localhost:3004.

```bash
# Backend services and frontend together.
# Prepare the service .env files and databases first; see the backend runbook.
npm run infra:up
npm run migrate
npm run db:seed
npm run dev:all
```

`npm run dev` continues to start only the four backend services. `dev:all` starts those services and the frontend; it does not start Docker infrastructure or apply migrations automatically.

## Verification and production startup

```bash
npm run typecheck --workspace @saga/web
npm run build:web
npm run start:web
```

Production startup also uses port 3004. Stop the development server before starting production on the same port. Root `npm run build` and `npm run typecheck` include this workspace.

Development uses Turbopack. Production builds explicitly use Next.js's supported Webpack option because Turbopack's production CSS worker could not bind a local port in the implementation environment. The Webpack production build and Turbopack development page were verified successfully.

The frontend has its own TypeScript configuration because Next.js uses bundler module resolution, while the backend uses NodeNext. Dependencies are recorded in the root package-lock.json; do not create a separate workspace lockfile.

## Step 2: layout and navigation

| Route | Screen |
| --- | --- |
| `/` | Overview and workspace shortcuts |
| `/orders/new` | Create order layout preview |
| `/orders` | Order lookup and recent orders layout preview |
| `/attention` | Intervention queue layout preview |
| `/services` | Service descriptions and readiness check categories |

All routes share the desktop sidebar, header, and footer. Below 1024px, navigation opens in a native modal drawer with keyboard focus containment, Escape/backdrop dismissal, focus restoration, and scroll locking. Selecting a route or resizing to desktop closes the drawer. A skip link provides direct keyboard access to the main content.

The UI explicitly labels its preview state. Checkout and search controls are disabled; service cards say “Not checked.” No API requests, order writes, polling, or invented business metrics are included in this step.

Reusable primitives live in `src/components/ui`: buttons and links, labeled inputs, cards, status badges, icons, empty states, loading indicators, skeletons, and retryable error states. `src/components/layout` contains navigation, the application shell, page headings, and preview notices. App Router loading, error, and not-found files keep navigation available during page-level transitions and failures.

## Frontend checks

Install the browser once, then run the frontend checks from the repository root:

```bash
npm exec --workspace @saga/web -- playwright install chromium
npm run test:web
```

`test:web` runs component checks, builds the production application, and runs Playwright against a temporary server at `127.0.0.1:3104`. Port 3104 must be free; the suite deliberately does not reuse an existing server. It stops its server when finished and does not require Docker or the backend.

The browser suite covers direct routes, active navigation, browser history, disabled preview controls, 404 recovery, skip-link focus, mobile drawer behavior, responsive overflow, and automated WCAG accessibility checks. It uses desktop and mobile Chromium configurations, captures a full-page image of each main screen in `apps/web/test-results`, and saves an HTML report in `apps/web/playwright-report`. These output folders are ignored by Git. Browser automation requires permission to start local processes and bind a port.

To run checks separately:

```bash
npm run test:ui --workspace @saga/web
npm run typecheck
npm run build:web
npm run test:e2e --workspace @saga/web
```

Automated accessibility checks supplement keyboard and screenshot review; they do not establish complete accessibility conformance or validate backend workflows planned for later steps.

## Verification result

Verified on 2026-09-08:

- Root `npm run typecheck` passed for the shared package, four services, and frontend.
- `npm run test:web` passed: 5 component checks, the Webpack production build, and 22 browser checks with no failures or skips.
- All five main routes returned HTTP 200; the unknown-page check returned HTTP 404 with a working recovery link.
- Automated WCAG A/AA scans reported no violations on the five pages in desktop/mobile configurations or in the open mobile drawer.
- Layout overflow checks passed on every main page at 320px, 768px, 1024px, and 1440px widths.
- Keyboard checks verified the skip link, explicit forward/reverse focus wrapping in the drawer, Escape dismissal, focus restoration, and drawer cleanup after navigation and resizing.
- Desktop and mobile screenshots were reviewed for layout and readability. The test server was managed and stopped by Playwright.

These results cover the Step 2 layout using Chromium. Backend integration, other browser engines, and later order workflows are outside this verification.

See the [frontend implementation plan](../../FRONTEND_IMPLEMENTATION_PLAN.md) and [backend startup runbook](../../docs/PART_10_VALIDATION.md).
