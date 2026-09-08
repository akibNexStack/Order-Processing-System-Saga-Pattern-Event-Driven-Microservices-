# Saga frontend

Next.js App Router workspace for the order-processing microservices. Step 1 provides the application foundation, TypeScript, Tailwind CSS, and the Zustand dependency. Navigation, API integration, and Zustand stores belong to later steps.

Run commands from the repository root after installing dependencies with `npm ci`:

```bash
# Frontend only; infrastructure is not needed for the foundation page.
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

See the [frontend implementation plan](../../FRONTEND_IMPLEMENTATION_PLAN.md) and [backend startup runbook](../../docs/PART_10_VALIDATION.md).
