# HeavyCards

Swedish e-commerce store for sealed Pokémon TCG products: a single Next.js
application containing the public storefront, the `/admin` application and all
server-side logic. Market: Sweden only, Swedish UI, SEK.

- **Specification:** [PROJECT.md](PROJECT.md) is the canonical source of requirements.
- **Architecture decisions:** [docs/architecture.md](docs/architecture.md).

## Status

| Milestone                 | State |
| ------------------------- | ----- |
| 1 — Repository foundation | Done  |
| 2 — Database foundation   | Next  |
| 3–15                      | —     |

Sections below marked _(later milestone)_ are placeholders and are filled in as
those features land.

## Technology stack

Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

| Area       | Choice                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Runtime    | Node.js 24.x LTS (Vercel default)                                          |
| Framework  | Next.js 16.3 (App Router, Turbopack), React 19.3, TypeScript 6.0           |
| Styling    | Tailwind CSS 4.3, shadcn/ui conventions (`components.json`, `cn()`)        |
| Validation | Zod 4                                                                      |
| Quality    | ESLint 9 (`eslint-config-next`), Prettier 3                                |
| Tests      | Vitest 5 (unit/domain), Playwright 1.63 (E2E, desktop + mobile Chromium)   |
| Planned    | PostgreSQL + Prisma, Stripe Checkout, Resend, Vercel Blob, React Hook Form |

## Local setup

Requirements: **Node.js 24.x** (see `.nvmrc`) and npm 11.

`.npmrc` sets `engine-strict=true`, so installing on another Node major fails on purpose.

```bash
npm install
cp .env.example .env.local   # then adjust values as needed
npm run dev                  # http://localhost:3000
```

## Environment variables

All variables are documented in [.env.example](.env.example). Only real secrets
go in `.env.local`, which is git-ignored. Never commit secrets or place them in
this README.

Validation lives in `src/lib/env/schema.ts` and runs:

- during `next build`, when the root layout is prerendered, so an invalid configuration fails the build;
- at server startup, via `src/instrumentation.ts`.

`APP_URL` is required for any production build or server, except on Vercel
previews, which fall back to the deployment URL. Server code reads validated
values from `@/lib/env/server`, which is marked `server-only`.

## Scripts

| Script              | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `npm run dev`       | Development server                                               |
| `npm run build`     | Production build (requires `APP_URL`)                            |
| `npm run start`     | Serve the production build                                       |
| `npm run lint`      | ESLint, zero warnings allowed                                    |
| `npm run format`    | Format with Prettier (`format:check` verifies only, used in CI)  |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit`                |
| `npm test`          | Vitest, single run (`test:watch` for watch mode)                 |
| `npm run test:e2e`  | Playwright against the production build (build first, see below) |

Database migration and seed scripts are added in Milestone 2.

## Testing

**Unit and domain tests** live in `tests/` (Vitest, Node environment):

```bash
npm test
```

**End-to-end tests** live in `e2e/` and run against a production build on port
3100 (override with `E2E_PORT`):

```bash
npx playwright install chromium   # first time only
APP_URL=http://localhost:3100 npm run build
npm run test:e2e
```

Every E2E test runs on a desktop and a mobile (Pixel 7) Chromium profile.

CI (`.github/workflows/ci.yml`) runs `npm ci`, format check, lint, typecheck,
unit tests, build and E2E on every push to `main` and on pull requests.

## Health check

`GET /api/health` returns `{"status":"ok"}` with `Cache-Control: no-store` and
`X-Robots-Tag: noindex`. It deliberately exposes no version or configuration
details. A database readiness check is added in Milestone 2.

## Project structure

```
src/
  app/            routes: (store)/ public storefront, api/ route handlers, admin/ (later)
  components/     store/, admin/, ui/ (shadcn/ui components)
  lib/            framework-level modules: env, config, auth, db, stripe, email, storage, seo, validation
  server/         domain/ rules, services/ use cases, data/ Prisma queries (server-only)
  types/          shared TypeScript types
  instrumentation.ts
tests/            Vitest tests (mirrors src/ paths)
e2e/              Playwright tests
public/brand/     official HeavyCards logo goes here (see below)
docs/             architecture decisions
```

## Branding

The official HeavyCards logo is **not yet in the repository**. Place it at
`public/brand/heavycards-logo.*`. Until then the UI uses a temporary text-only
wordmark. Do not replace or redraw the logo.

## Database, migrations and seed _(Milestone 2)_

## Stripe local webhook development _(Milestones 8–9)_

## Email development _(Milestone 10)_

## Admin bootstrap _(Milestone 6)_

## Deployment _(Milestone 15)_

Target platform: Vercel with Node.js 24.x (from `engines.node`).
