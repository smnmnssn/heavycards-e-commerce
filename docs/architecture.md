# Architecture decisions

Concise record of decisions not fully prescribed by [PROJECT.md](../PROJECT.md).
Newest milestone last. Each entry says what was decided and why.

## Milestone 1 — Repository foundation (2026-09-30)

### Toolchain versions

All versions were verified against the npm registry and each other's `engines`
and `peerDependencies` on 2026-09-30. Where the newest release was not
compatible, the newest compatible release was chosen:

| Package    | Pinned | Newest available | Why not newest                                                                                                                                                                    |
| ---------- | ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 24.x   | 26.x (Current)   | 24 is the active LTS line and Vercel's default. Vercel deprecates Node 20 on 2026-10-01. Vitest 5 requires Node ≥ 22.12.                                                          |
| TypeScript | 6.0.3  | 7.0.2            | `typescript-eslint` 8.71 (used by `eslint-config-next`) supports `<6.1.0`. Next.js itself builds with 6.0.                                                                        |
| ESLint     | 9.39.5 | 10.11.0          | `eslint-config-next` 16.3.8 depends on `eslint-plugin-react`, `-import` and `-jsx-a11y`, which support ESLint ≤ 9. Verified: ESLint 10 crashes (`getFilename is not a function`). |
| React      | 19.3.0 | 19.3.0           | —                                                                                                                                                                                 |

**Known risk:** ESLint 9 reached end-of-life on 2026-08-06. It is a development-only
tool and never ships to production. Upgrade to ESLint 10 as soon as
`eslint-config-next` supports it.

`vite` is a direct dev dependency because Vitest 5 declares it as a peer
dependency. Pinning it keeps the version explicit.

### Environment validation

- `src/lib/env/schema.ts` holds a pure Zod parser. It is testable and has no framework imports.
- `src/lib/env/server.ts` exposes the parsed `env`. It is marked `server-only`, so it cannot be bundled into client code.
- Validation runs at build time (root layout prerender) and at server boot (`instrumentation.ts`). With an invalid configuration, the build fails. A started server logs the error and answers every request, including `/api/health`, with HTTP 500, so it fails closed.
- Error messages name variables but never echo values, so secrets cannot leak into logs.
- Variables join the schema in the milestone that first reads them. `.env.example` already lists them all.
- `APP_URL` resolution order:
  1. explicit `APP_URL`, which must be https in Vercel production;
  2. the Vercel preview deployment URL;
  3. `http://localhost:3000` outside production.

  Production never silently falls back, because a wrong canonical origin damages SEO and email links.

### shadcn/ui setup

`components.json` uses the current CLI defaults (`radix-nova`, neutral, CSS
variables). Two things differ from `shadcn init`:

- `cn()` is implemented locally with `clsx` + `tailwind-merge` instead of the newer `cn` npm package, which is pre-1.0 and ships a build-time compiler. Components import `@/lib/utils` either way, so the CLI is unaffected.
- `radix-ui`, `lucide-react`, `class-variance-authority`, `tw-animate-css` and the `shadcn` runtime stylesheet are not installed until a component actually needs them (Milestone 3 onward).

### Security baseline

`next.config.ts` sends these on every response:

- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`

It also disables `X-Powered-By`, and sends `X-Robots-Tag: noindex, nofollow` on `/admin/**` and `/api/**`.

A full CSP is deferred until the Stripe, storage and analytics origins are known. HSTS is provided by Vercel.

### Testing layout

- Vitest runs in a Node environment and covers `tests/**/*.test.ts`. `server-only` is aliased to a stub, so server modules can be unit tested.
- Playwright runs against the production build (`next start`), not the dev server, so tests see real rendering and caching. It uses desktop and mobile Chromium profiles, with locale `sv-SE` and timezone `Europe/Stockholm`.

### Install policy

`.npmrc` sets:

- `save-exact=true`, so no `^`/`~` ranges get added by accident;
- `engine-strict=true`, so installs on the wrong Node major fail.

npm 11 warns that `unrs-resolver`'s postinstall script (a native-binding fallback installer pulled in by `eslint-import-resolver-typescript`) is not in `allowScripts`. The platform binding installs as a normal optional dependency, so the script is intentionally left unapproved.

## Milestone 2 — Database foundation (2026-09-30)

Schema details, delete behavior, money, order numbers, reservations and token
storage are documented in [database.md](database.md). This section records the
tooling decisions.

### Prisma 7.10.0 (not 8)

npm's `latest` tag for `prisma` points at `8.0.0-rc.19`, a release candidate.
7.10.0 is the newest stable release, and `@prisma/client` and
`@prisma/adapter-pg` are pinned to the same version. Prisma 7 specifics:

- The `prisma-client` generator writes TypeScript to `src/generated/prisma`.
  That directory is git-ignored and regenerated by `postinstall`. Browser-safe
  enums are imported from `@/generated/prisma/enums`.
- Connections go through the `pg` driver adapter (`src/lib/db/create-client.ts`).
- `prisma.config.ts` holds the datasource URL and seed command. Prisma 7 does
  not load env files, so the config loads `.env.local` with Node's built-in
  `process.loadEnvFile`, which avoids a `dotenv` dependency. The URL is read
  from `process.env` (not `env()`), so `prisma generate` works without a
  database.
- `migrate dev` no longer generates the client or seeds, so those are
  explicit scripts.

### ESM and TypeScript target

- The package is now `"type": "module"`, as Prisma 7 recommends for its ESM
  client. All config files were already ESM or `.mjs`, so nothing else changed.
- `tsconfig` `target` moved from ES2017 to ES2023 (also Prisma's recommendation;
  it's needed for BigInt literals). It only affects type checking; Next.js/SWC
  decide browser output.

### Local database

- `compose.yaml` runs `postgres:18.6-alpine`, the latest stable (19 is in
  beta). It listens on **127.0.0.1:54320**, not 5432, to avoid clashing with
  other local PostgreSQL servers, and binds to loopback only.
- `docker/postgres/init` creates `heavycards_test` on first start.

### Seed safety

`prisma/seed.ts` refuses to run:

- in production (`NODE_ENV`/`VERCEL_ENV`);
- against non-local hosts, unless `SEED_ALLOW_REMOTE_DATABASE=true`.

It seeds no credentials; the dev admins have no password until Milestone 6.

### Test layout

Vitest now has two projects:

- `npm test` runs `unit` (no external services).
- `npm run test:db` runs `db` against a real PostgreSQL database.

DB tests only accept `TEST_DATABASE_URL`, and the database name must end in
`_test`. They migrate it on startup and truncate all tables between tests.
CI runs a PostgreSQL 18.6 service and, on every run:

- migrates an empty database from zero;
- checks for drift (`db:check`);
- seeds twice to prove idempotency;
- runs the DB tests.

### Health endpoint

`/api/health` now runs `SELECT 1` and returns 503 `{"status":"unavailable"}`
when the database is unreachable. It exposes no error details.

### Known risks and accepted findings

- `npm audit` reports 4 high findings: `mysql2` 3.15.3 and `deepmerge-ts` 7.1.5.
  - Both are exact dependencies of the **`prisma` CLI**. npm also counts them
    under `--omit=dev`, because `@prisma/client` declares `prisma` as a peer.
    However, Next.js output file tracing (`.next/**/*.nft.json`) confirms that
    only `@prisma/client` and its runtime utilities ship to the server; the CLI,
    `mysql2` and `deepmerge-ts` are never deployed or loaded at runtime.
  - `mysql2` is only loaded for MySQL datasources; we use PostgreSQL.
  - `deepmerge-ts` only merges our own local config, never untrusted input.
  - Overriding Prisma's pinned versions would create an untested combination,
    so this is accepted and documented instead. Re-check when upgrading Prisma.
- npm 11.19 warns that install scripts for `@prisma/engines`, `prisma`,
  `esbuild` (via `tsx`) and `unrs-resolver` are not in `allowScripts`. They
  currently still run, and a clean `npm ci` was verified to produce a working
  Prisma setup. If npm starts enforcing `allowScripts`, approve `@prisma/engines`
  and `prisma`.

## Milestone 3 — Storefront design foundation (2026-09-30)

The design system is documented in [design-system.md](design-system.md) and
the route map in [routes.md](routes.md). This section records the decisions.

### Dependencies

- **Added:** only `@axe-core/playwright` 4.13.0 (dev), for automated WCAG
  checks in E2E.
- **Not added:**
  - no icon library: nine hand-drawn SVG icons;
  - no animation library: CSS transitions and one keyframe;
  - no headless UI or Radix dependency: the native `<dialog>` handles the
    mobile menu;
  - no `class-variance-authority`: variant maps in plain TypeScript;
  - no typography plugin: a small `.prose-store` component class.

### Font

- One variable font, Archivo (weight and width axes), self-hosted via
  `next/font/google`.
- The file is downloaded at build time and served from our own origin, so
  there are no runtime requests to Google (a GDPR consideration).
- `next/font` also sizes the fallback font to avoid layout shift.

### TypeScript target

- Unchanged since Milestone 2 (ES2023).
- `tests/unit` now also accepts `.test.tsx`. Components are unit-tested by
  rendering them to static HTML in Node, with no jsdom dependency.

### Routes and pending links

- The navigation links to `/nyheter`, `/pokemon-tcg`, `/kommande` and `/sok`,
  which Milestone 4 implements. Until then they return the Swedish 404 page.
- Next.js viewport prefetching logged 404s for them, so `e2e/pending-routes.ts`
  was a temporary allowlist. Milestone 4 built the routes and deleted the file;
  the smoke test now tolerates no failed requests at all.
- Information and legal routes exist as `noindex` placeholders pending the
  owner's content and legal review.

### 404 page inside the shell

- Unmatched URLs render the root `not-found.tsx` outside the `(store)` layout,
  so it wraps itself in `StoreShell`.
- Admin (Milestone 6+) has its own layout. Unmatched admin URLs will still
  show the storefront 404 page, which is acceptable because it exposes nothing.

### Database check

- `AuditLog.adminUserId` is a nullable `uuid` foreign key, so system events are
  stored as `NULL`. An empty-string pseudo-ID is impossible, because
  PostgreSQL cannot store `''` in a `uuid` column.
- No schema change was needed. A DB test now asserts both properties.

## Milestone 4 — Catalog (2026-10-01)

Routes are listed in [routes.md](routes.md). Storefront rules are in
`src/server/domain/catalog.ts`.

### Query architecture

- `src/server/data/catalog-queries.ts` is the only catalog data access. Its
  functions take the Prisma client explicitly, so DB tests run the exact
  production queries against the test database.
- **Listings** (all product grids, search, homepage sections, related
  products) use **one parameterized SQL query** (`listProducts`). It
  computes `available = stock_on_hand − active unexpired reservations` in a
  lateral join, so the "in stock" filter, sorting and paging all agree with
  the badges. The same query:
  - picks the first image in another lateral join;
  - returns the total with `count(*) OVER ()`.

  A page therefore costs a single round trip.

- User input reaches SQL only as bound parameters; `ORDER BY` fragments come
  from a fixed whitelist.
- **Product pages** use Prisma (product with category, set and images), then
  three queries in parallel: active reservations, the newest 20 approved
  reviews, and the approved-review aggregate.
- Lookups needed by both `generateMetadata` and the page are deduplicated
  with React `cache`.
- DB tests assert that the SQL visibility and availability rules equal the
  domain functions (`isListable`, `availableToSell`) for every seeded
  product.
- Listings are bounded: 24 per page, offset pagination. Out-of-range pages
  return 404.

### Rendering and caching (PROJECT.md §59, §92)

| Pages                                                                    | Strategy                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Homepage, information pages                                              | ISR, `revalidate = 60`                                                                |
| Product pages                                                            | ISR, `revalidate = 60`, rendered on first visit (`generateStaticParams` returns `[]`) |
| `/pokemon-tcg`, `/kategori/*`, `/set/*`, `/nyheter`, `/kommande`, `/sok` | Dynamic, since they read `searchParams`                                               |

- Displayed stock and price can therefore be at most 60 seconds old on cached
  pages. That is acceptable because checkout re-validates everything
  server-side (Milestone 8).
- Admin changes (Milestone 7) and payments (Milestone 9) should call
  `revalidatePath` for affected product, category and homepage paths.
- Cache Components (`cacheComponents`) is **not** enabled; this uses the
  established ISR model.
- **Consequence:** `next build` prerenders the homepage and information pages
  from the database, so builds need a reachable `DATABASE_URL`. CI and Vercel
  builds have one.

### Real 404s vs streaming

- A `loading.tsx` boundary starts streaming with status 200 before the page
  can call `notFound()`; Next.js then only adds `noindex`, a "soft 404".
- Product, category and set routes therefore have **no** loading boundary, so
  unknown slugs return a real 404.
- `/nyheter`, `/kommande` and `/sok` keep loading skeletons. Their only
  `notFound()` case is an out-of-range page number, which is `noindex` anyway.

### Server vs client

The only new client component is `ProductGalleryInteractive`, rendered only
when a product has two or more images. Everything else stays on the server:
listings, filters (plain GET forms), pagination (links), search, reviews and
the purchase panel.

### Search

- Search matches all terms (AND) with `LIKE` against name, short description,
  SKU, category name and set name. Terms are at least 2 characters, at most 5
  terms, and `%`/`_` are escaped.
- Accented e is folded, so "pokemon" finds "Pokémon"; å, ä and ö are kept.
- Relevance order: products whose _name_ matches all terms come first, then
  newest.
- This is enough for the V1 catalog and needs no extension or separate
  service. To upgrade later, replace the SQL behind `listProducts` (e.g.
  `pg_trgm` or full-text search) without touching pages.

### Store settings in the footer

- The footer reads contact email, company name and organisationsnummer from
  `StoreSettings` via `getPublicStoreInfo()`.
- Missing settings or fields are omitted; with no settings row at all, the
  low-stock threshold falls back to 0 (no "few left" labels).
- The seed's contact email is an `example.com` placeholder, and the seed sets
  no company name or number.

### Dependencies

None added.

## Milestone 5 — Cart (2026-10-01)

### Cart state architecture

| Layer                                                                                  | Module                              | Runs on           |
| -------------------------------------------------------------------------------------- | ----------------------------------- | ----------------- |
| Domain rules: add/set/remove, totals, persistence parsing, one-shipment rules          | `src/lib/cart/cart.ts`              | client and server |
| Evaluation of a cart against current product data (issues, conflict, display subtotal) | `src/lib/cart/evaluate.ts`          | client and server |
| Product data for cart IDs (price, availability, limit, shipment group)                 | `src/server/cart/cart-products.ts`  | server            |
| Read-only JSON endpoint                                                                | `POST /api/cart`                    | server            |
| Client store: state, storage, hydration, announcements                                 | `src/components/cart/cart-store.ts` | client            |
| React glue: provider, trigger, add-to-cart, drawer                                     | `src/components/cart/*.tsx`         | client            |

- The store is a small framework-free class read through React's
  `useSyncExternalStore`. No global-state dependency was added.
- Mutations are synchronous against a single state object, so rapid clicks
  always build on the latest quantity.
- The server snapshot is an empty cart, so SSR and hydration always agree; the
  badge appears once `localStorage` has been read.
- Storage and fetch are injected, so the store is unit-tested in Node (races,
  corrupt or blocked storage, stale data, conflicts).

### Persistence format

- `localStorage["heavycards:cart"]` = `{"v":1,"lines":[{"id":"<uuid>","q":2}]}`.
- Only product IDs and quantities are stored, never prices, stock, status,
  shipping or totals.
- Parsing never throws:
  - malformed JSON, an unknown version or a wrong shape → empty cart;
  - invalid lines are dropped (non-UUID IDs, non-integer or < 1 quantities);
  - duplicates are merged;
  - quantities are clamped to 99 per line, with at most 50 lines.
- Blocked or full storage leaves the cart working in memory.
- Changes in another tab sync through the `storage` event.

### Hydration and validation

- The drawer shows **only server data**. `POST /api/cart` takes up to 50 UUIDs
  (Zod-validated) and returns, per product: name, slug, set, first image,
  **current** price, whether it is purchasable now, why not, the maximum
  orderable quantity (available-to-sell after active reservations, capped at 99) and the shipment group. It sends `Cache-Control: no-store`.
- Drafts, unpublished and unknown IDs return only `not_found`, so the
  endpoint reveals nothing about unpublished products.
- Data is refreshed when the page loads with a stored cart and whenever the
  drawer opens.
- The product page seeds its own product's view (`toCartProductView`, the
  same builder the endpoint uses) so adding needs no round trip.
- **Milestone 8 reuse:** checkout should call `loadCartProducts` inside its
  transaction (after locking the product rows) and `evaluateCart`, then
  compute authoritative totals and shipping. The client subtotal is a display
  estimate only and is labelled "Slutligt pris bekräftas i kassan".

### Preorder compatibility (locked V1 rules)

- `ShipmentGroup` is either stock, or preorder with its release date.
  `isPreorder` decides, even after the release date has passed.
- A cart may hold only in-stock products, or only preorders with **one
  identical** release date. Preorders without a known date combine only with
  themselves.
- Adding an incompatible product changes nothing in the cart. The customer
  sees a Swedish explanation and a "Visa kundvagnen" action.
- Unavailable products in a stored cart never block additions; they cannot be
  ordered anyway.
- If a stored cart becomes incompatible later (e.g. a release date changes),
  the drawer shows the conflict and checkout stays blocked.

### Stale carts, quantity and stock

- Lines whose product is no longer purchasable stay visible with a Swedish
  reason until the customer removes them. They count in the badge, are
  excluded from the subtotal, and block checkout.
- Quantities above current availability are lowered to the maximum when data
  loads. The change is explained on the line and announced.
- The product page limits the stepper to the available quantity minus what is
  already in the cart.
- These are UX guards only. Milestone 8 validates stock transactionally.

### Server vs client changes

- New client code: `CartProvider`, `CartTrigger`, `AddToCart`, `CartDrawer`,
  `QuantityStepper`.
- The layout, header, product page and catalog remain Server Components.
  `StoreShell` wraps them in the provider without converting them.

### Logo

- `public/brand/heavycards-mark.svg` is rendered by `BrandMark` as a CSS mask
  filled with `currentColor`: one source for light and dark surfaces, with a
  forced-colors fallback.
- It replaces the text wordmark in the header and footer, and inside image
  placeholders.

### Seed

- Added "Kommande set Booster Bundle", a preorder releasing 30 days after the
  other upcoming products, so the different-release-date rule is exercised in
  development and E2E. Seeded products: 13.
- The seeded pending checkout reservation expires 30 minutes after seeding.
  Tests that depend on availability read it rather than hard-coding it.

### Dependencies

None added.
