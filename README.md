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

| Milestone                  | State  |
| -------------------------- | ------ |
| 1 — Repository foundation  | Done   |
| 2 — Database foundation    | Done   |
| 3 — Storefront design      | Done   |
| 4 — Catalog                | Done   |
| 5 — Cart                   | Done   |
| 6 — Admin authentication   | Done   |
| 7 — Product administration | Done   |
| 8 — Checkout and inventory | Done   |
| 9 — Stripe webhooks        | Done   |
| 10 — Transactional email   | Done   |
| 11 — Verified reviews      | Done   |
| 12 — Admin operations      | Review |
| 13–15                      | —      |

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
| Auth/email | Better Auth 1.7.7 (admin authentication), Resend 6.31 (admin and order emails)             |
| Admin      | React Hook Form 7.89 with `@hookform/resolvers` 5.9 (shared Zod schemas)                   |
| Images     | Vercel Blob 2.8 behind `src/lib/storage` (local files in development), sharp 0.35          |
| Payments   | Stripe Hosted Checkout via `stripe` 23.0 (API version `2026-09-30.endive`)                 |

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
under [Email](#email). Payment settings (`STRIPE_SECRET_KEY`,
`PAYMENT_GATEWAY`) are described under [Stripe](#stripe-checkout-and-local-development). Server code reads validated
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

Every storefront and admin E2E test runs on a desktop and a mobile (Pixel 7)
Chromium profile.

The admin tests sign in as the seeded administrators, so `SEED_ADMIN_PASSWORD`
must be set (in `.env.local`) and `npm run db:seed` must have run with it. The
test server writes emails to `.e2e-outbox/` instead of sending them. Tests that
invite administrators create `e2e-…@heavycards.test` accounts in the
development database; they are deactivated by the test and can be ignored.

The catalog administration tests (`e2e/admin-catalog.spec.ts`) publish
products, so they run as a separate `catalog-admin` project after the
storefront projects have finished. They create products, categories and sets
with an `E2E-`/`e2e-` prefix in the development database and delete them
(and their uploaded images in `.e2e-storage/`) before and after the run. This
project uses desktop Chromium; its phone-layout checks open a Pixel 7
context. To run only them:
`npx playwright test --project catalog-admin --no-deps`.

The checkout tests (`e2e/checkout.spec.ts`) run last, as the `checkout`
project. The test server uses the fake payment gateway
(`PAYMENT_GATEWAY=fake`), which never contacts Stripe and returns
`checkout.stripe.com` URLs that the tests intercept. The tests create their own
`CHK-E2E-` products, pending orders and reservations, and delete them before
and after the run, so the seeded catalog never gains reservations. To run only
them: `npx playwright test --project checkout --no-deps`.

Payment outcomes are tested the same way, without live Stripe: the fake
gateway keeps its sessions as JSON files in `.e2e-stripe/`
(`FAKE_STRIPE_STATE_DIR`), a test edits a file to play "the customer paid" (or
"the session expired", "the delayed payment failed") and then sends a
correctly signed event to `/api/stripe/webhook` with the local-only secret in
`e2e/storage-dir.ts`.

The review tests (`e2e/reviews.spec.ts`) run after checkout, as the `reviews`
project. They create `REV-E2E-` products with paid orders, ship them through
the real fulfillment service and outbox (`e2e/support/review-actions.ts`, run
with tsx), follow the review link from the shipping email in `.e2e-outbox/`,
and delete everything again. The moderation test waits up to the product
page's 60-second cache window, because its staff action runs outside the web
server. To run only them: `npx playwright test --project reviews --no-deps`.

The admin operations tests (`e2e/admin-operations.spec.ts`) run last, as the
`admin-operations` project: dashboard, order search and detail, fulfillment
up to SHIPPED with the shipping email, refunds, needs-attention items, review
moderation through the admin screen (published on the product page at once),
store settings (footer and checkout shipping follow) and role boundaries,
also on a phone. They use `OPS-E2E-` products and orders, restore the store
settings and delete their data again. To run only them:
`npx playwright test --project admin-operations --no-deps`.

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
  server/         domain/ rules, catalog/ presenters and redirects, data/ database queries,
                  admin/ services (administrators, catalog), media/ image processing
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

## Product images

Product images are uploaded in `/admin` and stored in object storage, never
in Git. Application code only uses the small interface in `src/lib/storage`;
the provider is chosen with `STORAGE_PROVIDER` (validated at startup):

| Provider      | Where                                                                                     | Used for                                                       |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `local`       | files in `STORAGE_LOCAL_DIR` (default `.storage/`, git-ignored), served by `/api/media/*` | default outside Vercel: development and E2E; refused on Vercel |
| `vercel-blob` | a public Vercel Blob store                                                                | default (and required) on Vercel                               |

**Local development** needs no account or configuration: uploads land in
`.storage/`.

**Vercel (Milestone 15 checklist):**

1. In the Vercel project, create a Blob store (Storage → Blob) with public
   access and connect it to the project. Vercel then sets
   `BLOB_READ_WRITE_TOKEN` for the selected environments.
2. Production fails to start without `BLOB_READ_WRITE_TOKEN`. A preview
   without it keeps working, but uploads show "Bildlagringen är inte
   konfigurerad".
3. To try real Blob uploads locally, set `STORAGE_PROVIDER=vercel-blob` and
   `BLOB_READ_WRITE_TOKEN` (a development store's token) in `.env.local`.

Uploads accept JPEG, PNG and WebP up to 4 MB (at least 300 px on the
shortest side). The server checks the real file contents, re-encodes the
image (correct orientation, camera/GPS metadata removed, at most 2 400 px)
and records its dimensions. Details: docs/architecture.md → Milestone 7.

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

## Stripe Checkout and local development

Customers pay on Stripe Hosted Checkout; HeavyCards never sees card data. The
flow, reservations and idempotency are described in
[docs/architecture.md](docs/architecture.md) → Milestones 8 and 9.

**Keys.** `STRIPE_SECRET_KEY` is a secret or restricted key from the Stripe
Dashboard (Developers → API keys). Use **test-mode** keys (`sk_test_…` /
`rk_test_…`) everywhere except Vercel production. The environment validation
refuses live keys outside Vercel production and requires a live key there, so
test and live credentials are never mixed. Without a key the store still runs;
"Till kassan" then shows "Det gick inte att starta betalningen". A restricted
key needs write access to Checkout Sessions and read access to Checkout
Sessions, PaymentIntents, Charges and Refunds.

**Trying checkout locally.** Put a test key in `.env.local`, forward webhooks
with the [Stripe CLI](https://docs.stripe.com/stripe-cli) and start the app:

```bash
stripe login                                   # once, test mode
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copy the printed whsec_… into .env.local as STRIPE_WEBHOOK_SECRET
npm run dev
```

Check out with a test card (e.g. `4242 4242 4242 4242`). The forwarded
`checkout.session.completed` event marks the order PAID, reduces stock and
fills in the customer details; the confirmation page then shows the order.
Without `stripe listen` the order stays PENDING (honestly shown as "being
verified") until reconciliation asks Stripe, after the session's expiry. `stripe trigger` sends events
for sessions HeavyCards did not create; they are acknowledged and ignored.

**Without Stripe.** `PAYMENT_GATEWAY=fake` uses an in-process stand-in that
never contacts Stripe (the E2E tests use it). It is refused on Vercel.

**Payment methods.** The application does not list payment methods: Stripe
offers whatever is enabled in the Dashboard (Settings → Payment methods) and
eligible for the session. For the Swedish store enable Cards, Swish and Klarna
there, in test mode first. Their availability depends on the Stripe account
and is not simulated by the application.

**Webhooks.** `/api/stripe/webhook` verifies every event's signature with
`STRIPE_WEBHOOK_SECRET` over the raw body and records processed event IDs, so
redeliveries change nothing. For a deployment, create an endpoint in the
Dashboard (Developers → Webhooks) pointing to
`https://<domain>/api/stripe/webhook`, subscribed to exactly these events,
and store its signing secret in `STRIPE_WEBHOOK_SECRET`:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `refund.created`, `refund.updated`, `refund.failed`

Refunds are made in the Stripe Dashboard. HeavyCards records only refunds
Stripe reports as succeeded (a pending refund changes the order once it
succeeds) and never restocks automatically.

**Reconciliation.** If a webhook is missed, stock reserved for a Stripe
session stays reserved until Stripe's answer is known (nothing is freed just
because time passed). `GET /api/cron/reconcile-checkouts` asks Stripe about
overdue checkouts and applies the result; `vercel.json` schedules it daily
(the most a Vercel Hobby plan allows), and every checkout request also
reconciles a few overdue ones. On a Pro plan, change the schedule to every 15
minutes. The route requires `Authorization: Bearer $CRON_SECRET`; to run it
locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reconcile-checkouts
```

## Email

Admin invitations, password resets and the customer order emails (order
confirmation, shipped) are sent by email. `EMAIL_TRANSPORT` selects delivery:

| Value     | Behaviour                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console` | Default outside Vercel production. Nothing is sent; the server log shows recipient and subject, and in `next dev` also the message with its link. |
| `resend`  | Real delivery via Resend. Default and required in Vercel production. Needs `RESEND_API_KEY` and `EMAIL_FROM`.                                     |
| `file`    | Nothing is sent; messages are written as JSON to `EMAIL_OUTBOX_DIR`. Used by the E2E tests; refused on Vercel.                                    |

Order emails go through an outbox (`email_deliveries`): paying or shipping an
order records the email in the same transaction, and it is sent afterwards,
retried with backoff and protected by Resend idempotency keys
(`order-confirmation/<order id>`, `order-shipped/<order id>`). Details:
docs/architecture.md → Milestone 10.

The shipping email contains the order's secure review link
(`/review/<token>`, valid 180 days, one review per purchased product). The
token is never stored; it is re-derived from `AUTH_SECRET` for every send, so
retries carry the same link. Details: docs/architecture.md → Milestone 11.

Development and tests never email customers:

- With `console` (the local default), order emails are logged only as
  masked recipient and subject; their content (personal data) is never
  printed.
- E2E runs use `file`; each order email lands in `.e2e-outbox/` as
  `key-<idempotency key>.json`.
- DB tests inject an in-memory transport.
- `EMAIL_TRANSPORT=resend` is refused when `NODE_ENV=test`.

To try real delivery locally, use a Resend test key with
`EMAIL_FROM="HeavyCards <onboarding@resend.dev>"`. Resend's testing domain only
delivers to your own Resend account address.

Pending and retryable order emails are sent by the scheduled run:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reconcile-checkouts
```

Remaining Resend setup before production (Milestone 15; the full checklist is
in docs/architecture.md → Milestone 10):

1. Verify the sending domain in Resend (SPF/DKIM DNS records, plus DMARC).
2. Create a sending-only API key for that domain and set `RESEND_API_KEY` in
   Vercel (Production only).
3. Set `EMAIL_FROM` to an address on the verified domain, e.g.
   `HeavyCards <order@heavycards.se>`. Production refuses placeholder domains
   (`example.com`, `.invalid`, `resend.dev` …).
4. Set the store's contact email (`/admin/settings`) to the real customer-service mailbox (it is
   the reply-to address of order emails).

## Admin access

Administrators sign in at `/admin/login`. There is no public sign-up. Roles:

- **OWNER**: everything, including administrator management at `/admin/users`.
- **ADMIN**: the admin area except administrator management.

Both roles run the store day to day:

| Area                                                   | Route                                                 |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Overview: work to do, problems, sales, recent activity | `/admin`                                              |
| Orders: search, detail, fulfillment, tracking          | `/admin/orders`, `/admin/orders/[id]`                 |
| Review moderation                                      | `/admin/reviews`                                      |
| Catalog: products, categories, Pokémon sets            | `/admin/products`, `/admin/categories`, `/admin/sets` |
| Store settings (OWNER edits, ADMIN reads)              | `/admin/settings`                                     |
| Administrators (OWNER only)                            | `/admin/users`                                        |

Normal store operation needs no Prisma Studio or database access. Every
change is written to the audit log; an order's history is shown on its page.

- **Refunds** are made in the Stripe Dashboard (each order links to its
  payment) and synchronized back automatically. They never change stock;
  adjust a product's stock if a returned item can be sold again.
- **Kräver åtgärd.** Payment, email and stock problems that the system
  stopped on (instead of guessing) appear on the overview and the order.
  "Markera som hanterat" removes an item from the list once dealt with; it
  changes nothing else. A payment problem whose order still holds stock
  cannot be marked handled: "Kontrollera med Stripe igen" asks Stripe again
  and lets the payment service finalize the order (paid) or release the
  stock (expired or failed). Otherwise the stock stays reserved and the
  problem stays visible.
- **Store settings vs. configuration.** `/admin/settings` holds the business
  rules: store name, customer-service email, company name and
  organisationsnummer, flat shipping price, free-shipping threshold, default
  carrier, VAT rate for new orders, low-stock threshold and the homepage's
  SEO texts. Technical configuration stays in environment variables and is
  never shown in admin: Stripe and Resend keys, `EMAIL_FROM`, `AUTH_SECRET`,
  `DATABASE_URL`, `CRON_SECRET`, storage tokens and `APP_URL`. A fresh
  production database has no settings row: checkout stays closed until the
  OWNER saves the settings form once.

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
