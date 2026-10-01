# HeavyCards

Swedish e-commerce store for sealed Pokémon TCG products: a single Next.js
application containing the public storefront, the `/admin` application and all
server-side logic. Market: Sweden only, Swedish UI, SEK.

- **Specification:** [PROJECT.md](PROJECT.md) is the canonical source of requirements.
- **Architecture decisions:** [docs/architecture.md](docs/architecture.md).
- **Database design:** [docs/database.md](docs/database.md).
- **Design system:** [docs/design-system.md](docs/design-system.md).
- **Routes:** [docs/routes.md](docs/routes.md).

## Status

| Milestone                 | State  |
| ------------------------- | ------ |
| 1 — Repository foundation | Done   |
| 2 — Database foundation   | Done   |
| 3 — Storefront design     | Done   |
| 4 — Catalog               | Done   |
| 5 — Cart                  | Done   |
| 6 — Admin authentication  | Review |
| 7–15                      | —      |

Sections below marked _(later milestone)_ are placeholders and are filled in as
those features land.

## Technology stack

Versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

| Area       | Choice                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| Runtime    | Node.js 24.x LTS (Vercel default)                                                          |
| Framework  | Next.js 16.3 (App Router, Turbopack), React 19.3, TypeScript 6.0                           |
| Styling    | Tailwind CSS 4.3, Archivo variable font, shadcn/ui conventions (`components.json`, `cn()`) |
| Database   | PostgreSQL 18 (local via Docker), Prisma ORM 7.10 with the `pg` adapter                    |
| Validation | Zod 4                                                                                      |
| Quality    | ESLint 9 (`eslint-config-next`), Prettier 3                                                |
| Tests      | Vitest 5 (unit/domain/components), Playwright 1.63 + axe (E2E, desktop + mobile Chromium)  |
| Auth/email | Better Auth 1.7.7 (admin authentication), Resend 6.31 (admin emails)                       |
| Planned    | Stripe Checkout, Vercel Blob, React Hook Form                                              |

## Local setup

Requirements: **Node.js 24.x** (see `.nvmrc`), npm 11 and Docker (for the local
PostgreSQL database).

`.npmrc` sets `engine-strict=true`, so installing on another Node major fails on purpose.

```bash
npm install                  # also generates the Prisma client
cp .env.example .env.local   # defaults match the local database below
docker compose up -d         # PostgreSQL 18 on localhost:54320
npm run db:deploy            # apply migrations
npm run db:seed              # development data (safe to re-run)
npm run dev                  # http://localhost:3000
```

Set `AUTH_SECRET` in `.env.local` before starting (see below). To sign in to
`/admin` locally, see [Admin access](#admin-access).

## Environment variables

All variables are documented in [.env.example](.env.example). Only real secrets
go in `.env.local`, which is git-ignored. Never commit secrets or place them in
this README.

Validation lives in `src/lib/env/schema.ts` and runs:

- during `next build`, when the root layout is prerendered, so an invalid configuration fails the build;
- at server startup, via `src/instrumentation.ts`.

`DATABASE_URL` and `AUTH_SECRET` (at least 32 characters, e.g.
`openssl rand -base64 32`, unique per environment) are required everywhere.
`APP_URL` is required for any production build or server, except on Vercel
previews, which fall back to the deployment URL. `APP_URL` is also the only
origin trusted by the admin login's origin/CSRF checks.

Email settings (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`) are described
under [Email](#email). Server code reads validated
values from `@/lib/env/server`, which is marked `server-only`.

## Scripts

| Script                       | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                | Development server                                                       |
| `npm run build`              | Production build (requires `APP_URL`)                                    |
| `npm run start`              | Serve the production build                                               |
| `npm run lint`               | ESLint, zero warnings allowed                                            |
| `npm run format`             | Format with Prettier (`format:check` verifies only, used in CI)          |
| `npm run typecheck`          | Generate Next.js route types, then `tsc --noEmit`                        |
| `npm test`                   | Vitest, single run (`test:watch` for watch mode)                         |
| `npm run test:db`            | Vitest against the PostgreSQL test database                              |
| `npm run test:e2e`           | Playwright against the production build (build first, see below)         |
| `npm run db:migrate`         | Create and apply a migration after editing the schema (dev only)         |
| `npm run db:deploy`          | Apply pending migrations (CI, production)                                |
| `npm run db:check`           | Validate the schema and verify the database matches it (drift)           |
| `npm run db:seed`            | Load development seed data (refuses production/remote databases)         |
| `npm run db:reset`           | Drop and recreate the dev database, then seed (asks to confirm)          |
| `npm run db:generate`        | Regenerate the Prisma client (runs automatically on install)             |
| `npm run admin:create-owner` | Create the first OWNER administrator (see [Admin access](#admin-access)) |

## Testing

**Unit and domain tests** live in `tests/unit/` (Vitest, no external services):

```bash
npm test
```

**Database tests** live in `tests/db/`. They run against `TEST_DATABASE_URL`
(whose name must end in `_test`), migrate it automatically and empty it
between tests. They never touch `DATABASE_URL`:

```bash
docker compose up -d
npm run test:db
```

**End-to-end tests** live in `e2e/` and run against a production build on port
3100 (override with `E2E_PORT`):

```bash
npx playwright install chromium   # first time only
APP_URL=http://localhost:3100 npm run build
npm run test:e2e
```

Every E2E test runs on a desktop and a mobile (Pixel 7) Chromium profile.

The admin tests sign in as the seeded administrators, so `SEED_ADMIN_PASSWORD`
must be set (in `.env.local`) and `npm run db:seed` must have run with it. The
test server writes emails to `.e2e-outbox/` instead of sending them. Tests that
invite administrators create `e2e-…@heavycards.test` accounts in the
development database; they are deactivated by the test and can be ignored.

CI (`.github/workflows/ci.yml`) runs on every push to `main` and on pull requests:

- `npm ci`, format check, lint, typecheck and unit tests;
- against a fresh PostgreSQL service: migrate from zero, drift check, seed
  twice, database tests;
- build and E2E.

## Health check

`GET /api/health` runs a `SELECT 1` against PostgreSQL. It returns
`{"status":"ok"}` (200), or `{"status":"unavailable"}` (503) when the database
is unreachable. Responses carry `Cache-Control: no-store` and
`X-Robots-Tag: noindex`, and expose no version, configuration or error details.

## Project structure

```
src/
  app/            routes: (store)/ public storefront, api/ route handlers, admin/ (later)
  components/     store/, admin/, ui/ (shadcn/ui components)
  lib/            framework-level modules: env, config, auth, db, stripe, email, storage, seo, validation
  server/         domain/ rules, catalog/ presenters, data/ database queries (server-only)
  types/          shared TypeScript types
  generated/      Prisma client (generated, git-ignored)
  instrumentation.ts
prisma/           schema.prisma, migrations/, seed.ts + seed/
docker/           local PostgreSQL init scripts (compose.yaml at the root)
tests/            unit/ (Vitest) and db/ (Vitest + PostgreSQL)
e2e/              Playwright tests
public/brand/     official HeavyCards logo goes here (see below)
docs/             architecture decisions
```

## Branding and design

The official HeavyCards mark is `public/brand/heavycards-mark.svg` (single
colour, `currentColor`). One file serves light and dark surfaces through the
`BrandMark` component (CSS mask). Do not replace, redraw, rasterize or
recolour it.

The design system (tokens, typography, components, accessibility) is described
in [docs/design-system.md](docs/design-system.md). In development, open
http://localhost:3000/designsystem for a visual reference of all primitives.

## Database, migrations and seed

Design decisions are in [docs/database.md](docs/database.md).

**Local database.** `docker compose up -d` starts PostgreSQL 18.6 on
`127.0.0.1:54320`, with a `heavycards` database for development and
`heavycards_test` for automated tests. `docker compose down -v` deletes all
local data.

**Schema changes.** Never edit a database by hand:

1. Edit `prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name <change>`.
3. Review the generated SQL. Hand-written CHECK constraints belong in the migration too.
4. Run `npm run db:check`.
5. Commit the schema and migration together.

Deployments apply migrations with `npm run db:deploy`. Never use
`db:reset` or `migrate dev` against production.

**Seed.** `npm run db:seed` is idempotent and creates:

- store settings with placeholder commercial values;
- three admins: `owner@heavycards.test` (OWNER), `admin@heavycards.test`
  (ADMIN) and `inactive@heavycards.test` (inactive ADMIN). They have a
  password only if `SEED_ADMIN_PASSWORD` is set (local only, at least 12
  characters). There is no default password;
- 6 categories, 7 Pokémon sets and 12 products covering: in stock, low stock,
  sold out, on sale, coming soon, preorder, draft, archived and accessory;
- 5 orders: shipped, processing, partially refunded, pending with an active
  reservation, and an expired checkout;
- approved, pending and rejected verified reviews, an example redirect and
  audit log entries.

All people, addresses and Stripe IDs are fictional. The seed refuses to run in
production and against non-local databases unless
`SEED_ALLOW_REMOTE_DATABASE=true` is set (disposable staging only).

## Stripe local webhook development _(Milestones 8–9)_

## Email

Admin invitations and password resets are sent by email (order emails follow
in Milestone 10). `EMAIL_TRANSPORT` selects delivery:

| Value     | Behaviour                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console` | Default outside Vercel production. Nothing is sent; the server log shows recipient and subject, and in `next dev` also the message with its link. |
| `resend`  | Real delivery via Resend. Default and required in Vercel production. Needs `RESEND_API_KEY` and `EMAIL_FROM`.                                     |
| `file`    | Nothing is sent; messages are written as JSON to `EMAIL_OUTBOX_DIR`. Used by the E2E tests; refused on Vercel.                                    |

Remaining Resend setup before production (Milestone 15):

1. Verify the sending domain in Resend (SPF/DKIM DNS records).
2. Create a sending-only API key and set `RESEND_API_KEY` in Vercel
   (Production only).
3. Set `EMAIL_FROM` to an address on the verified domain, e.g.
   `HeavyCards <admin@heavycards.se>`.

## Admin access

Administrators sign in at `/admin/login`. There is no public sign-up. Roles:

- **OWNER**: everything, including administrator management at `/admin/users`.
- **ADMIN**: the admin area except administrator management.

**First OWNER (production or a fresh database).** Run once, against the target
database, from a trusted machine:

```bash
DATABASE_URL=... npm run admin:create-owner -- --email owner@example.com --name "Förnamn Efternamn"
```

- The password is asked for twice in a hidden prompt (minimum 12 characters,
  paste and password managers work). It is never accepted as an argument and
  never printed.
- To run it non-interactively, pipe the password on stdin.
- The command refuses when an active OWNER already exists or the email is
  taken.
- Sign in afterwards at `/admin/login`.

**More administrators.** An OWNER invites them at `/admin/users`.

- The invitee receives a single-use link, valid for 72 hours, and chooses a
  password; the account is then active.
- Invitations always create the ADMIN role.
- OWNERs can deactivate and reactivate administrators. Deactivation ends the
  account's sessions immediately.
- The last active OWNER can never be deactivated.

**Forgotten password.** Use "Glömt lösenordet?" on the login page.

- The link is valid for one hour and can be used once.
- Changing the password signs out all sessions.

**Local development.** Either:

- set `SEED_ADMIN_PASSWORD` in `.env.local` and run `npm run db:seed`, then
  sign in as `owner@heavycards.test` or `admin@heavycards.test`; or
- run `npm run admin:create-owner` against an empty database.

Sessions last 8 hours. Security design: docs/architecture.md → Milestone 6.

## Deployment _(Milestone 15)_

Target platform: Vercel with Node.js 24.x (from `engines.node`).
