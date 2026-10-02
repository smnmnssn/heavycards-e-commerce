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
- Admin catalog changes revalidate these pages on demand since Milestone 7
  (see below). Payments (Milestone 9) should do the same.
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

## Milestone 6 — Admin authentication (2026-10-01)

### Library and versions

- `better-auth` **1.7.7**: latest stable on npm when installed; 1.7.6 was
  requested and 1.7.7 is the patch release after it. It brings
  `@better-auth/core` and `@better-auth/prisma-adapter` 1.7.7 transitively.
  Integrations used: `better-auth/adapters/prisma`, `better-auth/next-js`
  (`toNextJsHandler`, `nextCookies`), `better-auth/cookies`
  (`getSessionCookie`) and `better-auth/client`.
- `resend` **6.31.0** for email. Its optional React Email peer is not
  installed; templates are plain HTML and text.
- Password hashing, credential verification, session tokens and cookie
  signing are all done by Better Auth. The application never hashes or
  compares a password itself. The bootstrap CLI and invitation acceptance call
  Better Auth's own hasher (`ctx.password.hash` / `hashPassword` from
  `better-auth/crypto`; scrypt with N=16384, r=16, p=1).

### One identity, one password store

- `AdminUser` is mapped as Better Auth's `user` (`modelName: "adminUser"`).
  `role` and `isActive` are `additionalFields` marked `input: false`. Better
  Auth's `session`, `account`, `verification` and `rateLimit` models map to
  `AdminSession`, `AdminAccount`, `AuthVerification` and `AuthRateLimit`.
- The only password is `admin_accounts.password` (credential provider). The
  unused `admin_users.password_hash` column was dropped.
- IDs stay Prisma `uuid(7)` (`advanced.database.generateId: false`).
- Administrators are created only by the bootstrap CLI or an accepted
  invitation. Both run in our own transaction (user row, credential account
  and audit entry), never through Better Auth's sign-up.

### No public sign-up; endpoint allowlist

- `emailAndPassword.disableSignUp: true`, plus `disabledPaths` for every core
  endpoint the app does not use.
- `/api/auth/[...all]` also answers 404 for any path not in
  `ALLOWED_AUTH_ENDPOINTS`:
  - `sign-in/email`, `sign-out`, `get-session`;
  - `request-password-reset`, `reset-password`;
  - `ok`, `error`.

  This also covers parameterised paths that `disabledPaths` cannot match
  exactly. Tested in `tests/unit/app/api/auth-route.test.ts` and
  `tests/db/admin-auth.test.ts`.

### Sessions and cookies

- **Lifetime.** Fixed 8 hours (`expiresIn`), with no sliding refresh
  (`disableSessionRefresh`) and no cookie cache. Every lookup reads the
  session and user rows, so sign-out, deactivation and password reset take
  effect on the next request.
- **Cookie.** `heavycards-admin.session_token`, signed with `AUTH_SECRET`:
  `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800`. On HTTPS (an
  `APP_URL` starting with `https://`) it is also `Secure` and gets the
  `__Secure-` prefix.
- **Inactive administrators** are blocked in three places:
  - At sign-in, a `session.create.before` database hook refuses the session
    with Better Auth's own wrong-password error, so the response is
    byte-identical to a wrong password.
  - On every request, `resolveAdminSession` rejects sessions of inactive
    users.
  - Deactivation deletes the user's sessions and pending reset values.
- **Logging.** Session tokens, cookies, passwords and raw tokens are never
  logged. A DB test captures console output during a full sign-in and reset
  flow and asserts that none of them appears.

### Authorization design

- **Helpers** in `src/lib/auth/session.ts`:
  - `getCurrentAdmin()`: cached per request with React `cache`;
  - `requireAdmin()`: redirects to `/admin/login?next=…`;
  - `requireOwner()`: throws `ForbiddenError` for an ADMIN.
- **Pages** each call `requireAdmin()` themselves. The `(panel)` layout also
  calls it, but layouts are not re-run on every navigation, so it is not
  relied on.
- **Actions and services** check twice. Server actions call `requireOwner()`.
  The services in `src/server/admin/*` then re-load the actor inside their
  transaction and require an active OWNER again (`assertActingOwner`). This
  catches a role or status change between the session read and the write.
- **Proxy.** `src/proxy.ts` (the Next 16 proxy) only redirects requests that
  have no session cookie, and passes the requested path on for the post-login
  redirect. It never verifies the cookie and is not the security boundary.
- **ADMIN on OWNER-only pages.** These pages render a server-side "Behörighet
  saknas" panel without loading any data, and actions return a real error.
  Next's `forbidden()` would give a true 403 status, but it still requires the
  experimental `authInterrupts` flag in 16.3, so it is not used.
- **Permissions in V1:**
  - OWNER: everything, including `/admin/users` (list administrators, invite
    ADMINs, revoke invitations, deactivate and reactivate administrators).
  - ADMIN: the admin area except administrator management.
  - Later milestones decide which settings count as sensitive (OWNER only).
- **Final OWNER.** Owners cannot deactivate themselves, and the last active
  OWNER can never be deactivated, even under concurrency. See
  docs/database.md → Administrators and audit.

### Login and redirects

- The login form calls Better Auth's HTTP endpoint through the browser client,
  so rate limiting and origin checks apply. A server action would call
  `auth.api` directly and bypass the rate limiter.
- Every credential failure shows "E-postadress eller lösenord är felaktigt."
  A rate-limited request (429) shows a "too many attempts" message, which
  reveals nothing about accounts.
- `safeAdminRedirect` accepts only same-origin, protected `/admin` paths. It
  rejects:
  - `//host` and `/\host`;
  - schemes and control characters;
  - traversal out of `/admin`;
  - the public auth pages.
- A signed-in visit to the login page redirects to the validated destination.

### Origin and CSRF

- **Better Auth's model.** The Origin header is checked against `APP_URL` on
  every cookie-bearing request, and Fetch Metadata blocks cross-site sign-in
  attempts from browsers.
- **Explicit settings.** `disableOriginCheck: false` and
  `disableCSRFCheck: false` are set explicitly. Otherwise Better Auth skips
  the origin check when `NODE_ENV=test`, and the tests would not reflect
  production.
- **Trusted origins.** Only `APP_URL`; no extra origins.
- **Server actions** (sign-out, invitations, activation) rely on Next.js's
  built-in Origin/Host check.
- **E2E.** The test server runs with `APP_URL=http://localhost:3100`, so
  origin checks pass without being relaxed.

### Rate limiting

- **Storage.** Better Auth's limiter with `storage: "database"`
  (`auth_rate_limits`), so every serverless instance shares one counter. An
  in-memory store would be separate per instance on Vercel.
- **Rules** (per client IP and path):

  | Endpoint               | Limit             |
  | ---------------------- | ----------------- |
  | Sign-in                | 10 per 5 minutes  |
  | Password-reset request | 5 per 15 minutes  |
  | Password reset         | 10 per 15 minutes |
  | Everything else        | 60 per minute     |

- **Client IP.** Taken from `x-forwarded-for` (single value). On Vercel the
  platform sets this header, so clients cannot choose their IP. Behind a proxy
  that passes a client-supplied header through, the limiter could be
  bypassed; configure `advanced.ipAddress.trustedProxies` in that case.
- **Not rate limited:**
  - the invitation-acceptance action (256-bit tokens make brute force
    infeasible);
  - the OWNER-only actions (callers are authenticated).
- **No per-account lockout.** Per-IP limits plus long passwords are the V1
  defence.

### Password policy and reset

- **Policy.** 12 to 128 characters. No composition rules, any characters
  allowed, never trimmed. Inputs are plain `type="password"` fields with
  correct `autocomplete` values, so password managers and paste work.
- **Reset flow:**
  - The response is the same for every address.
  - Emails go only to active administrators.
  - The token is Better Auth's own: valid for one hour, single use, with its
    identifier stored hashed (`verification.storeIdentifier: "hashed"`).
  - Delivery runs in Next's `after()`, so response time does not reveal
    whether an email was sent.
  - `revokeSessionsOnPasswordReset` signs out every session.
  - No security questions.
  - The emailed link points to `/admin/reset-password?token=…`.

### Invitations

- **Creating.** The OWNER enters a name and email. The role is always ADMIN:
  the form has no role field, and the server ignores any posted role. The
  token is 256-bit (`generateSecureToken`). Only its SHA-256 is stored; it
  expires after 72 hours and works once. Any previous open invitation for the
  same address is revoked. If the email cannot be delivered, the invitation
  is revoked and the OWNER sees an error.
- **Accepting** happens in one transaction: the administrator is created from
  the stored invitation (email, name, role), the password is set with Better
  Auth's hasher, and the invitation is claimed with a conditional update.
  Concurrent or repeated submissions fail with the same generic message as
  expired, revoked or malformed tokens.

### Email foundation

- **Transports** (`src/lib/email/transport.ts`):
  - `resend`: real delivery;
  - `console`: logs recipient and subject; the message body and link only
    outside production builds;
  - `file`: one JSON file per message, for E2E;
  - a memory transport for the DB tests.
- **Defaults.** `EMAIL_TRANSPORT` defaults to `resend` only in Vercel
  production and to `console` everywhere else. Development, CI and previews
  therefore never mail real recipients unless configured to.
- **Guards.** `console` and `file` are refused in Vercel production; `file` is
  refused on any Vercel deployment.
- Order emails and a fuller layout come in Milestone 10.

### Bootstrap and seed

- **Bootstrap.** `npm run admin:create-owner -- --email … --name …` creates the
  first OWNER.
  - The password comes from a hidden prompt (entered twice) or the first line
    of piped stdin. It is never taken from arguments and never printed.
  - The script refuses when an active OWNER exists or the email is taken.
  - Concurrent runs are serialised with an advisory lock.
- **Seed.** The development seed creates `owner@`, `admin@` and
  `inactive@heavycards.test`.
  - They get a password only when `SEED_ADMIN_PASSWORD` is set; there is no
    default in source.
  - The seed guard still refuses production and remote databases.
  - CI generates a random `SEED_ADMIN_PASSWORD` and `AUTH_SECRET` per run.

### Testing

- **Unit:** env rules, redirect safety, password policy, email templates and
  transports, the endpoint allowlist and the proxy.
- **DB** (`tests/db/admin-*.test.ts`) runs the real Better Auth configuration
  against the test database. It covers:
  - sign-in, generic errors, cookies, CSRF and the absence of sign-up;
  - sessions, inactive denial, sign-out and password reset;
  - rate limits and logging;
  - roles and the final OWNER, including concurrency;
  - invitations and bootstrap.
- **E2E** (`e2e/admin.spec.ts`, on desktop and mobile) covers:
  - redirects, invalid and inactive login, and keyboard login;
  - OWNER and ADMIN sessions, the shell and sign-out;
  - open-redirect protection and server-side denial for ADMIN;
  - the full invitation → activation → sign-in → deactivation journey;
  - axe checks.

  Each test uses its own client IP, so rate limits never collide.

### Dependencies

`better-auth` 1.7.7 and `resend` 6.31.0, both pinned exactly.

## Milestone 7 — Product administration (2026-10-01)

Admin routes are listed in [routes.md](routes.md); audit actions, redirects
and image rows in [database.md](database.md). There were **no schema
changes**: the Milestone 2 schema already had every field needed.

### Layers

| Layer                                                                | Module                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Form schemas (browser and server), slugs, SEK input parsing          | `src/lib/validation/catalog.ts`, `src/lib/slug.ts`, `src/lib/money.ts` |
| Upload policy (types, sizes, dimensions)                             | `src/lib/validation/product-images.ts`                                 |
| Storage abstraction and providers                                    | `src/lib/storage/*`                                                    |
| Image decoding and normalisation (sharp)                             | `src/server/media/product-image.ts`                                    |
| Catalog services: products, images, categories, sets, list queries   | `src/server/admin/catalog/*`                                           |
| Redirect writes and lookups                                          | `src/server/catalog/redirects.ts`                                      |
| Server actions (forms, images, delete)                               | `src/app/admin/(panel)/{products,categories,sets}/actions.ts`          |
| Upload route handler                                                 | `src/app/api/admin/products/[id]/images/route.ts`                      |
| Admin UI (React Hook Form client components, server-rendered pages)  | `src/components/admin/catalog/*`, `src/app/admin/(panel)/*`            |
| Admin rules shown to staff (low stock, preorder reminders, warnings) | `src/server/domain/catalog-admin.ts`                                   |
| SEO defaults shared by storefront pages and the admin search preview | `src/lib/seo/catalog-defaults.ts`                                      |

Services take the Prisma client (and storage) as arguments, so the DB tests
run the production code against the test database with in-memory storage.

### Dependencies

All four were verified against the npm registry on 2026-10-01 and pinned
exactly. `npm audit` is unchanged (only the 4 known Prisma CLI findings).

| Package               | Version | Why                                                                                                                                                                          |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-hook-form`     | 7.89.0  | Admin forms (PROJECT.md §4). Peer `react ^19` is satisfied.                                                                                                                  |
| `@hookform/resolvers` | 5.9.1   | `zodResolver` for the shared Zod 4 schemas (peer `zod ^4`). Used in `raw` mode, so the server receives the untransformed form values and parses them itself.                 |
| `@vercel/blob`        | 2.8.0   | Production image storage (PROJECT.md §4, Vercel Blob default). Only `put`/`del` are used, behind `ObjectStorage`. Brings `undici` 6 and `@vercel/oidc`.                      |
| `sharp`               | 0.35.5  | Already installed as Next.js's optional image dependency; now direct, because uploads are decoded and re-encoded on the server. Prebuilt binaries for Linux, Windows, macOS. |

### Authorization

- `canManageCatalog(role)` (OWNER and ADMIN) is the single rule; a future
  role without catalog access only changes there. The admin menu shows the
  catalog links when it holds, but hiding links is never the check.
- **Pages** call `requireAdmin()` and render a 403 panel when the rule fails.
- **Server actions** run through `asCatalogManager` (`requireCatalogManager`:
  no session → login redirect; wrong role → Swedish error). Every argument is
  validated (UUIDs, integers, arrays), and the form values again with the
  shared schema.
- **Services** re-load the acting administrator inside their transaction
  (`SELECT … FOR SHARE`) and require an active account with catalog rights,
  so a deactivation between the session check and the write is caught and
  cannot commit concurrently.
- **Upload route** checks, in this order and before reading the body: same
  origin (`Origin` must equal `APP_URL`; the session cookie is also
  `SameSite=Lax`), a valid session of an active administrator, the role, and
  the declared and actual body size.
- Unexpected errors are logged by error name only and shown as a generic
  Swedish message. Prisma and provider details never reach the browser.

### Products

- **Status and publishing.** Status is chosen in the form (Utkast, Aktiv,
  Kommer snart, Arkiverad). `publishedAt` is set the first time a product
  becomes ACTIVE or COMING_SOON and is never reset or moved, so it keeps
  meaning "first public" ("Nyheter", sitemap, redirect decisions).
- **Archive, not delete.** A product can be deleted only if it was never
  public and has no order lines, reservations or reviews (a mistaken draft).
  Everything else is archived: not purchasable, not listed, and its page stays
  as a `noindex` "Säljs inte längre" notice (Milestone 4 behaviour). The
  service checks this under a row lock; the RESTRICT foreign keys are the
  final guard.
- **Validation decisions.**
  - Price must be greater than 0 kr: a 0 kr price is almost certainly a typo
    and cannot be charged through Stripe.
  - Compare-at price must exceed the price (mirrors the CHECK constraint).
  - SKUs are stored uppercase, so uniqueness is effectively case-insensitive.
  - Prices are typed in kronor ("1 499,50") and parsed to öre with string
    arithmetic, never floats.
  - All product types can be chosen; V1 has no type-specific fields.
- **Concurrent edits.** Stock uses compare-and-set. The form sends the stock
  value it was loaded with, and a stock change is refused ("Lagersaldot har
  ändrats till N …") if the stored value differs (another administrator, or
  later a sale). An untouched stock field is never written. Other fields are
  last-write-wins, which is acceptable for a small team and keeps the form
  usable while sales change stock.
- **Duplicates.** Slug and SKU are pre-checked inside the transaction and
  reported on their fields; a unique-constraint race returns a generic field
  error instead of a Prisma error.

### Inventory and preorders

- Administrators set `stockOnHand` (whole number 0–1 000 000). Each change is
  audited as `UPDATE_PRODUCT_STOCK` with old and new values.
- Reservations are not touched. The form and the list show reserved and
  available-to-sell quantities, computed with the storefront rule.
- **Low stock** in admin means available-to-sell ≤
  `StoreSettings.lowStockThreshold` (the storefront's "Få kvar" threshold).
  The list marks "Lågt lager" and "Slut", offers a filter, and shows a count
  of published products with low stock.
- **Preorders** keep the Milestone 5 rules: `isPreorder` stays authoritative
  after the release date, and `stockOnHand` is the preorder allocation. The
  form, the edit page and the list warn when a preorder's release date has
  passed; nothing is changed automatically. Mixed preorder/in-stock checkout
  remains a Milestone 8 decision.

### Product images and storage

- **Abstraction.** `ObjectStorage` (`put(key, bytes, contentType)`,
  `delete(keys)`) is all that catalog code knows. Providers:
  - `vercel-blob`: public store, `addRandomSuffix: false`,
    `allowOverwrite: false`, one-year cache (objects are immutable). The
    token is passed explicitly, never picked up from ambient credentials.
  - `local`: files under `STORAGE_LOCAL_DIR` (default `.storage/`,
    git-ignored), served by `GET /api/media/*` with strict key validation.
    For development and E2E; refused on Vercel.
  - `memory`: DB tests.
- **Selection** (`STORAGE_PROVIDER`, validated at startup): `local` outside
  Vercel, `vercel-blob` on Vercel. `BLOB_READ_WRITE_TOKEN` is required in
  Vercel production. On a preview without it the store works and uploads fail
  with "Bildlagringen är inte konfigurerad …".
- **Keys** are generated by the server only:
  `products/<productId>/<uuid>.<jpg|png|webp>`. Only such keys are ever
  deleted from storage. The development seed's images (`seed/…`, served from
  `/public`) are rows without stored objects.
- **Validation pipeline** (nothing from the client is trusted):
  1. body ≤ 4 MB plus multipart overhead, enforced while reading the stream;
  2. format from magic bytes (JPEG, PNG, WebP only; SVG, GIF, HEIC and
     everything else are refused);
  3. the declared MIME type and the file extension must match the detected
     format;
  4. full decode by libvips with a 40-megapixel limit (decompression bombs,
     corrupt files); animated images are refused; shortest side ≥ 300 px,
     longest ≤ 8 000 px;
  5. re-encode in the same format: EXIF orientation applied, all metadata
     (camera, GPS) stripped, scaled to fit 2 400 px. The stored file's real
     width and height are recorded.
- **Why a route handler.** Uploads go to
  `POST /api/admin/products/[id]/images`, one file per request. A server
  action would buffer the whole body under a global size limit before any
  check; the route handler authorizes first and reads with a hard limit. 4 MB
  stays under Vercel's 4.5 MB function request limit.
- **Consistency.** Upload: process → store → insert row (product row
  locked, position = count, at most 12 images). If the insert fails, the
  stored object is deleted again. Removal and product deletion delete rows
  first and objects after commit; a failed object deletion is logged and
  leaves only an unreferenced file, never a broken image.
- **Order.** Positions are kept contiguous; reordering must list exactly the
  product's images. Position 0 is the primary image everywhere (listings,
  cart, product page, JSON-LD).
- **Alt text** is optional; blank uses the product name (Milestone 4 rule).
- `next.config.ts` lets `next/image` optimise only `/brand/**`,
  `/api/media/products/**` and
  `https://*.public.blob.vercel-storage.com/products/**`, never with query
  strings.

### Slug changes and redirects (PROJECT.md §61)

- When the slug of a product that has been public (`publishedAt` set), or of
  any category or set (their landing pages are always public), changes, the
  old path is recorded as a permanent redirect in the same transaction.
- Invariants (`src/server/catalog/redirects.ts`):
  - redirects that pointed at the old path are re-pointed to the new one (no
    chains);
  - a redirect whose source is the new path is removed (no loops, e.g. when
    renaming back);
  - sources stay unique;
  - a path that becomes live again (a new record with that slug) releases
    its redirect.
- Deleting a category or set redirects its URL to `/pokemon-tcg`, so an
  indexed URL never silently turns into a 404.
- **Serving.** Product, category and set pages look up the Redirect table
  only when the slug has no live page, and then answer with
  `permanentRedirect` (HTTP 308); otherwise a real 404. Live pages pay
  nothing and no proxy-level database lookup is needed. This also activates
  the seeded example redirect. A general redirect layer for other URL types
  belongs to Milestone 13.
- A never-published product can be renamed freely; no redirect is created.

### Cache revalidation

Milestone 4 left product pages and the homepage as ISR pages (60 s). Every
successful catalog mutation (product, image, category or set; server actions
and the upload route) now calls `revalidateCatalog()`:

| Target                                                                     | Why                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/`                                                                        | featured, new and upcoming sections, category tiles                               |
| `/(store)/pokemon-tcg/[productSlug]` (pattern)                             | the product's own page, and every page's related-products rail and taxonomy links |
| old and new product URL (literal)                                          | a renamed product's old URL serves its redirect immediately                       |
| `/pokemon-tcg`, `/nyheter`, `/kommande`, `/sok`, category and set patterns | rendered per request today; included so they stay correct if cached later         |

- Information pages and the store layout are not invalidated: they show no
  catalog data, so their caching is unaffected.
- Patterns include the `(store)` route group, because Next derives a page's
  implicit cache tags from its route file path.
- Pages are re-rendered on their next visit. E2E proves it: a price change,
  a publish and the "featured" flag appear on cached pages well inside the
  60 s window. With revalidation disabled the same tests fail (including a
  cached 404 for a just-published product).

### Admin UX

- The product form has the PROJECT.md §54 sections: Grundinformation, Pris
  och lager, Publicering och tillgänglighet, Bilder, Sökmotorer (SEO). Image
  changes are saved immediately, independently of the form's save button.
- Slugs are suggested from the name while creating. On a public record the
  form explains that the old URL will redirect.
- The SEO section shows character counts and a search-result preview built
  with the same default rules as the storefront.
- Feedback is Swedish: field errors next to inputs (from the browser or the
  server), and a success or error message next to the save button
  (`role="status"` / `role="alert"`).
- The product list has search (name, SKU, slug), filters (status, category,
  set, stock level), sorting and paging (50 per page). It is a table on
  large screens and stacked cards on phones.

### Testing

- **Unit:** schemas, slugs, SEK parsing, storage keys and local storage, the
  image pipeline (real images generated with sharp: EXIF/GPS stripping,
  orientation, downscaling; SVG, GIF, text, mismatched type or extension,
  corrupt, animated, too small, too large), revalidation targets, admin
  rules, list parameters, SEO defaults, the upload route (origin, session,
  size, roles, error hiding) and the media route.
- **DB:** product create/update/delete with audit, stock compare-and-set,
  publish/archive, redirects (chains, loops, never-published products),
  history protection (orders, reservations, reviews) and list filters;
  categories and sets (redirects, delete protection, display order); images
  (upload, invalid file, storage failure, limit, reorder, alt text, removal,
  primary image on the storefront); inactive and unknown administrators.
- **E2E:** a separate `catalog-admin` Playwright project runs after the
  storefront projects, because it publishes products. It uses `E2E-`/`e2e-`
  prefixes and deletes its data before and after. It covers:
  - access control, OWNER and ADMIN;
  - the list, its filters and the phone layout;
  - validation (browser and server);
  - create, edit, publish, archive and delete;
  - stale stock edits from a second administrator;
  - homepage and product-page revalidation, slug redirects;
  - preorder warnings;
  - image upload, validation, reorder, alt text and removal, with the image
    visible in the store;
  - category and set management, and axe checks.
- Two Milestone 6 E2E assertions listed the exact admin menu; they now
  include the catalog links (ADMIN still has no "Administratörer").

### Remaining decisions and limits

- **Production storage:** create a Vercel Blob store and connect it to the
  project (this sets `BLOB_READ_WRITE_TOKEN`). Decide whether previews share
  it or use a separate store (Milestone 15).
- **4 MB per image.** Larger photos must be resized before upload. Direct
  browser-to-Blob uploads would lift the limit but validate only after
  storing; not needed for V1.
- **Orphaned objects** can remain if a storage deletion fails. A periodic
  cleanup comparing stored keys with `product_images` can be added later.
- **Audit log viewing** in admin is not built yet (entries are written).
- Deleting a category or set redirects its URL to `/pokemon-tcg`; the owner
  may prefer another target in specific cases.

## Milestone 8 — Checkout and inventory reservation (2026-10-01)

Schema changes are in [database.md](database.md); routes in
[routes.md](routes.md). Payment completion (webhooks, PAID, stock decrement,
emails, clearing the cart) is Milestone 9 and is not implemented here.

### Layers

| Layer                                                                   | Module                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Request/response contract, Swedish failure messages, Stripe URL check   | `src/lib/checkout/checkout.ts` (isomorphic)                           |
| Pricing, shipping, VAT, issue detection, reservation timing             | `src/server/domain/checkout.ts` (pure)                                |
| Checkout service: reserve → Stripe → attach, idempotency, release       | `src/server/checkout/create-checkout.ts`                              |
| HTTP handling: origin, rate limit, body limit, validation, status codes | `src/server/checkout/handle-request.ts`                               |
| Payment gateway interface, Stripe implementation, fake, selection       | `src/server/checkout/{gateway,stripe-gateway,fake-gateway,server}.ts` |
| Stale-reservation cleanup                                               | `src/server/checkout/cleanup.ts`                                      |
| Transaction retry and PostgreSQL error classification                   | `src/server/db/transactions.ts`                                       |
| Rate limiting (PostgreSQL fixed window)                                 | `src/server/security/rate-limit.ts`                                   |
| Route handler (thin)                                                    | `src/app/api/checkout/route.ts`                                       |
| Browser: checkout action, attempt storage, error state                  | `src/components/cart/cart-store.ts`, `cart-drawer.tsx`                |
| Return pages                                                            | `src/app/(store)/kassa/{bekraftelse,avbruten}`                        |

`POST /api/checkout` is a route handler rather than a server action because
it needs a bounded body read, explicit status codes with `Retry-After`, and a
rate limit that runs before any parsing.

### Dependency

`stripe` **23.0.0**, the latest stable release (published 2026-10-01). It
pins API version `2026-09-30.endive`, which the gateway also passes
explicitly; the typed option only accepts the SDK's own version, so an SDK
upgrade fails type checking until the API version is reviewed. The 23.0
breaking changes were checked against our use: Node ≥ 20 (we use 24);
`payment_method_types` removed from Checkout Session creation (we rely on
dynamic payment methods anyway); webhook signature verification now applies
the default tolerance (relevant for Milestone 9). `npm audit` is unchanged
(only the 4 known Prisma CLI findings). No other package was added.

### Checkout request

The browser sends only:

```json
{
  "attemptId": "<uuid>",
  "previousAttemptId": "<uuid, optional>",
  "lines": [
    {
      "productId": "<uuid>",
      "quantity": 2,
      "expectedUnitPriceAmount": 219900
    }
  ]
}
```

The schema is strict: totals, shipping amounts or any other field are refused
(400). `expectedUnitPriceAmount` is the price the drawer displayed. It is
never charged; the server compares it with the current price and refuses the
checkout if they differ (see "Browser UX").

### Authoritative validation

Inside the reservation transaction, after locking the product rows, the
server reloads every product with `loadCheckoutProducts` (the Milestone 5
loader plus the SKU) and runs `evaluateCheckout`, which reuses the
Milestone 5 `evaluateCart` rules:

- the product exists and has a public page (draft, unpublished or unknown →
  `not_found`);
- it is purchasable now: ARCHIVED → `discontinued`, COMING_SOON without
  preorder → `coming_soon`, nothing available → `sold_out` /
  `preorder_sold_out`;
- quantity ≤ available-to-sell (`stockOnHand − active, unexpired
reservations`), otherwise `insufficient_quantity` with the available amount;
- the current price equals the displayed price, otherwise `price_changed`;
- one shipment: stock and preorders never mix; preorders only with one
  identical, known release date; `isPreorder` decides even after the release
  date has passed.

Totals come from the database only: line totals (`multiplyAmount`), subtotal,
flat or free shipping from `StoreSettings` (inclusive threshold,
`calculateShippingAmount`), total, and the VAT contained in the total
(`vatPortionOfGross` with `StoreSettings.vatRateBasisPoints`; shipping carries
the goods' rate). Missing store settings → "payment unavailable".

### Inventory locking strategy

One interactive transaction at PostgreSQL's default READ COMMITTED level:

1. `SET LOCAL lock_timeout = '5s'`;
2. `SELECT id FROM products WHERE id = ANY($ids) ORDER BY id FOR UPDATE`;
3. read the products and their active reservations, validate, price;
4. insert the order, its items and its reservations; commit.

A concurrent checkout for any of the same products blocks at step 2 until
the first one commits. Its step 3 is a new statement, so under READ COMMITTED
it sees the first transaction's committed reservations: the last unit can be
reserved only once. Locking in id order means two checkouts never wait on
each other in a cycle. Admin stock edits (and Milestone 9's payment
processing) update the product row as well, so they serialise with checkout.

SERIALIZABLE was not chosen: the row locks give the same guarantee here with
fewer aborted transactions. Deadlocks (`40P01`) and serialization failures
(`40001`, Prisma P2034) are still retried up to three times with jittered
backoff (`withTransactionRetry`); a lock timeout (`55P03`) answers 503
("busy"). With the pg adapter these errors arrive as Prisma P2010 with the
SQLSTATE in `meta.driverAdapterError.cause.originalCode` (verified
experimentally).

DB tests prove that 12 simultaneous checkouts for 1 unit create exactly one
order, that 15 simultaneous multi-unit checkouts never exceed stock, and that
carts listing the same products in opposite order do not deadlock.

### Reservation lifecycle and expiry

| Phase                    | What happens                                                                                                        | Reservation `expiresAt`                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1. reserve (transaction) | PENDING order, item snapshots, ACTIVE reservations; `checkoutExpiresAt` = now + 40 min, whole seconds               | now + **5 min** (provisional)           |
| 2. Stripe                | Checkout Session created with `expires_at = checkoutExpiresAt`                                                      | unchanged                               |
| 3. attach (transaction)  | order row locked; if still PENDING and every reservation still holds: store the session ID, extend the reservations | session `expires_at` + **15 min** grace |

- **Stripe expiry (verified against the API reference on 2026-10-01):**
  `expires_at` may be 30 minutes to 24 hours after creation (default 24
  hours). 40 minutes stays above the minimum even when the session is created
  at the end of the provisional window (an idempotent retry), and keeps
  abandoned checkouts from holding stock for long. The value is stored on the
  order (`checkoutExpiresAt`).
- **A reservation never expires while Stripe can accept payment:** it holds
  until the session's expiry plus 15 minutes, which also covers a payment
  completed at the last second whose webhook arrives later.
- **The payment URL is returned only after phase 3 has committed**, so nobody
  can pay a session whose stock is not reserved. If attaching fails (the
  order was released meanwhile), the session is expired at Stripe and the
  browser starts a new attempt.
- **Crashes:** a crash after phase 1 or 2 leaves only the 5-minute
  provisional hold, and the session URL never reached the customer. Nothing
  can hold stock permanently, because availability ignores expired
  reservations whatever their stored status.
- **Stripe failure:** the request that created the order releases it
  (reservations RELEASED, order EXPIRED) in a transaction that requires that
  no session is attached, so it can never undo a concurrent successful
  attach. A repeated request that fails releases nothing.
- **Cleanup safety net:** after every checkout request (`after()`),
  `releaseExpiredReservations` marks up to 200 expired ACTIVE reservations
  RELEASED (`FOR UPDATE SKIP LOCKED`) and old rate-limit windows are deleted.
  Correctness never depends on it; a scheduled job can call the same function
  later.
- **Milestone 9 must:** handle `checkout.session.expired`; extend the hold
  when a session completes with an asynchronous (delayed) payment; and decide
  what happens when a completion arrives after a hold lapsed.
- `stockOnHand` is never changed in Milestone 8.

### Idempotency

- **Attempt ID.** The browser generates a random UUID per checkout attempt
  and stores it (`localStorage["heavycards:checkout-attempt"]`, with a
  fingerprint of the lines and displayed prices) **before** sending, so a
  lost response, a double click or a return from Stripe repeats the same
  attempt. Blocked storage falls back to memory. `orders.checkout_attempt_id`
  is unique; two simultaneous submissions of one new attempt resolve to one
  order (the second re-reads after the lock wait or the unique violation).
- **Reuse rules.** A repeated attempt reuses its order only if its lines,
  quantities and displayed prices are identical, the order is PENDING, every
  reservation still holds, and at least 5 minutes of the session remain.
  Otherwise the server answers `attempt_closed` and the browser retries once
  with a new attempt ID.
- **Stripe idempotency key** `heavycards-checkout-<order id>`. The session
  parameters are derived deterministically from the stored order (items in a
  stable order, the stored expiry), so a retry returns the same session and
  URL. The Stripe client also retries network errors (2 retries, 20 s timeout)
  with the same key.
- **Superseding.** When the cart has changed, the browser sends its previous
  attempt ID. The server first expires that attempt's Stripe session (so it
  can no longer be paid), then releases its reservations and marks the order
  EXPIRED. A session the customer already completed is left alone for payment
  processing. The attempt ID is a 122-bit random value known only to that
  browser, so it is a sufficient capability; the public order number is never
  used for anything.
- **The customer's own hold in the cart.** `/api/cart` accepts the current
  attempt ID and does not count that attempt's reservations, so a customer
  back from Stripe who changes the cart does not see their own hold as "sold
  out" (found by E2E). Checkout always counts every reservation under the row
  locks, after releasing the previous attempt. Product pages (ISR, 60 s)
  still count it.

### Stripe Checkout configuration

`buildCheckoutSessionParams` (unit-tested, deterministic):

- `mode: payment`, `ui_mode: hosted_page`, `currency: sek`, `locale: sv`,
  `submit_type: pay`;
- line items from the order's snapshots (`price_data` with name and unit
  amount);
- one fixed shipping rate with the order's shipping amount, labelled
  "PostNord" or "Fri frakt (PostNord)" (from
  `StoreSettings.defaultShippingCarrier`, stored on the order);
- `shipping_address_collection.allowed_countries: ["SE"]`, so no other
  country can be chosen; `phone_number_collection` enabled (PostNord delivery
  notifications); billing address `auto`; `customer_creation: if_required`
  (guest checkout);
- **no `payment_method_types`:** Stripe's dynamic payment methods offer what
  is enabled in the Dashboard and eligible for the session (cards, Swish,
  Klarna);
- `client_reference_id`, `metadata` and `payment_intent_data.metadata` carry
  only `order_id` and `order_number`, never personal data;
- `success_url = APP_URL/kassa/bekraftelse?session_id={CHECKOUT_SESSION_ID}`,
  `cancel_url = APP_URL/kassa/avbruten`, built on the server from `APP_URL`
  with fixed paths; the client cannot influence them.

The full name Stripe collects with the shipping address is the customer's
single full name (`Order.customerName`, stored in Milestone 9). After
creation, the server checks `amount_total`, the currency and the URL against
the order; a mismatch expires the session and releases the order.

### Gateway abstraction and environments

`CheckoutGateway` has two methods: create and expire. `StripeCheckoutGateway`
is the only module that imports `stripe`. `FakeCheckoutGateway` keeps
sessions in memory, honours idempotency keys and returns
`checkout.stripe.com`-shaped URLs.

- `PAYMENT_GATEWAY=stripe` (default) uses `STRIPE_SECRET_KEY`. Live keys are
  refused outside Vercel production, and Vercel production requires a live
  key. Without a key, checkout answers "payment unavailable" and the rest of
  the store keeps working.
- `PAYMENT_GATEWAY=fake` is for local E2E runs and is refused on any Vercel
  deployment. DB tests inject the fake directly.

### Browser UX

- "Till kassan" is enabled when every line has current server data and the
  cart has no issues. While starting it reads "Startar betalningen…", then
  "Skickar dig till betalningen…" (`aria-busy`); repeated clicks are ignored.
- The browser follows only `https://checkout.stripe.com` URLs
  (`isStripeCheckoutUrl`), so a tampered response cannot redirect elsewhere.
- **Rejected cart:** the drawer reloads current data (new prices,
  unavailability, quantities lowered to what is left, with the Milestone 5
  per-line notes) and shows a `role="alert"` block: "Kundvagnen har ändrats.
  Kontrollera den och tryck på Till kassan igen.", followed by one Swedish
  line per problem (sold out, not enough left, no longer sold, price changed
  from X to Y, preorder conflict). Changing the cart clears the message.
- **Price changes:** if a price changed after the customer saw it, nothing is
  reserved or charged. The new price is shown and the customer must press
  "Till kassan" again, accepting it knowingly.
- Rate limiting has its own message; technical failures show "Det gick inte
  att starta betalningen. Försök igen."
- Starting checkout and the return pages never clear the cart; clearing after
  a verified payment belongs to Milestone 9.
- Returning with the back button (page cache) resets the button state.

### Return pages

- `/kassa/bekraftelse?session_id=…` shows only database state. PENDING →
  "Tack! Vi kontrollerar din betalning." with the public order number and an
  explanation that a confirmation follows by email. PAID/PARTIALLY_REFUNDED,
  REFUNDED and EXPIRED/FAILED have their own texts (reachable only once
  webhooks set those states). An unknown or malformed ID → "Vi hittade ingen
  beställning". Opening the URL never changes anything.
- `/kassa/avbruten`: "Betalningen avbröts", the cart is still there, with
  "Visa kundvagnen" and "Fortsätt handla". Pressing "Till kassan" with the
  same cart resumes the same Stripe session.
- Both are `noindex, nofollow`; `/kassa/**` also sends `X-Robots-Tag` and
  `Referrer-Policy: no-referrer`, because the session ID is in the URL.

### Security

- **CSRF:** `Origin` must equal `APP_URL` (403 otherwise), and the body must
  be JSON (415). The endpoint uses no cookies.
- **Abuse:** 15 checkout requests per client IP per 10 minutes (429 with
  `Retry-After`), counted atomically in PostgreSQL (`rate_limit_buckets`,
  shared by all instances). Only an HMAC of the IP (keyed with `AUTH_SECRET`)
  is stored, and windows older than a day are deleted. Together with
  superseding, one client can hold only a few short-lived reservations. A
  distributed attacker could still hold stock for up to about 55 minutes per
  reservation; stronger protection (bot checks, per-product caps) is a
  Milestone 14 decision.
- Body ≤ 16 KB, read with a hard limit; strict Zod schema (≤ 50 lines,
  quantity 1–99, UUIDs, no duplicate products).
- **Logging:** `[checkout]` logs contain only the error name, Stripe's error
  type, code and request ID, and our order ID; never messages, keys, IP
  addresses, customer addresses or tokens. A DB test asserts this.
- Customer-facing errors never include provider or database details.

### Testing

- **Unit:** pricing, shipping threshold, VAT, issue detection, reservation
  timing, attempt matching; the request schema (client totals refused), the
  Stripe URL check and the Swedish messages; Stripe session parameters
  (Sweden only, no payment-method list, no personal data in metadata,
  determinism) and the Stripe gateway with a mocked SDK; return-page states;
  transaction retry; environment rules; the cart store's checkout flow
  (attempt reuse, superseding, blocked storage, rejections, open-redirect
  guard, own-hold lookup).
- **DB:** pending order creation with snapshots, totals and reservations;
  shipping and threshold; every rejection reason; active vs expired vs
  released reservations; preorder rules; the provisional hold; release on
  Stripe failure and on an amount mismatch; abandoned reservations expiring
  and cleanup; idempotent retries and simultaneous double submission;
  superseding; attach after release; last-unit and multi-unit concurrency;
  lock ordering; the own-hold cart lookup; the HTTP handler (CSRF, content
  type, size, schema, 409/503/429, logging); the rate limiter; the
  `customerName` constraints; a replay of the migration on pre-migration rows.
- **E2E** (`checkout` project, fake gateway, the Stripe origin intercepted):
  cart → Till kassan → Stripe URL with a pending order and unchanged stock;
  the cancel page and resuming the same session; superseding the customer's
  own hold; the success page not claiming payment; unknown session IDs;
  reduced quantity, sold out, price change, preorder conflict (UI and a
  crafted request), cross-site request; phone viewport; axe on the drawer
  error state and the return pages.
- The Milestone 4 "Nyheter" E2E test read the cards before the streamed
  listing arrived and failed about one run in three, also on the Milestone 7
  build (verified by building that commit). It now waits for the first card.

### Known limits and production setup

- **Stripe account (Milestone 15):** enable Cards, Swish and Klarna under
  Settings → Payment methods (test mode first). Their eligibility depends on
  the account and is not simulated. Set the live `STRIPE_SECRET_KEY` only in
  Vercel production (a restricted key with write access to Checkout Sessions
  is enough), and configure the business name and branding shown on the
  hosted page.
- Until Milestone 9, a completed test payment leaves the order PENDING and
  its reservation lapses after the grace period; stock is not decremented.
- Prisma 7's query interpreter runs nested reads in parallel inside a
  transaction, so `pg` 8 prints a deprecation warning ("Calling client.query()
  when the client is already executing a query") during DB tests. The queries
  are queued correctly; re-check on Prisma upgrades.
- Product pages are ISR (60 s), so a just-reserved last unit can still show
  "I lager" there briefly; the drawer and checkout always use live data.

## Milestone 9 — Stripe webhooks and order finalization (2026-10-02)

Stripe is now the only source of payment truth. Schema details are in
[database.md](database.md), routes in [routes.md](routes.md). No emails are
sent (Milestone 10) and no review tokens are created (Milestone 11).

### Layers

| Layer                                                                      | Module                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Payment rules: transitions, session classification, customer data, refunds | `src/server/domain/payment.ts` (pure)                                                                            |
| Holding rule for reservations (domain, SQL fragment, Prisma filter)        | `src/server/domain/inventory.ts`, `src/server/data/reservations.ts`                                              |
| The one payment-finalization implementation (session → order)              | `src/server/payments/session-sync.ts`                                                                            |
| Refund synchronization                                                     | `src/server/payments/refund-sync.ts`                                                                             |
| Webhook: signature, idempotency, dispatch                                  | `src/server/payments/webhook.ts`                                                                                 |
| Reconciliation service and its cron entry point                            | `src/server/payments/{reconcile,cron}.ts`                                                                        |
| Revalidation after inventory changes (reuses Milestone 7 targets)          | `src/server/payments/revalidate.ts`                                                                              |
| Gateway reads: session state, session of a payment, refunded amount        | `src/server/checkout/{gateway,stripe-gateway,fake-gateway}.ts`                                                   |
| Routes (thin)                                                              | `src/app/api/stripe/webhook`, `src/app/api/cron/reconcile-checkouts`                                             |
| Confirmation page states and cart clearing                                 | `src/app/(store)/kassa/bekraftelse`, `src/components/cart/checkout-return.tsx`, `CartStore.completePaidCheckout` |

Services take the Prisma client and gateway as arguments, so the DB tests run
the production code with the fake gateway and signed events.

### Stripe event model (verified 2026-10-02)

Checked against Stripe's current Checkout fulfillment guide, event-type
reference and refund guide (API `2026-09-30.endive`):

- Fulfilment must be webhook-driven and must not rely on the landing page.
  Stripe recommends one idempotent "fulfill this session" function that
  **retrieves the session from the API** (not from the event payload) and
  checks `payment_status`, and that may be called repeatedly and
  concurrently.
- Delayed payment methods complete the session with `payment_status: unpaid`
  and later send `checkout.session.async_payment_succeeded` or
  `async_payment_failed`.
- `charge.refunded` covers full and partial refunds; `refund.created`,
  `refund.updated` and `refund.failed` report refund status changes
  (`charge.refund.updated` is deprecated). Refund statuses are `pending`,
  `requires_action`, `succeeded`, `failed` and `canceled`; failed and
  cancelled refunds return the money to the merchant.

**Handled events** (the endpoint must be subscribed to exactly these):

| Event                                      | HeavyCards effect                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `checkout.session.completed`               | paid → finalize; delayed payment → store the payment ID, keep the hold |
| `checkout.session.async_payment_succeeded` | finalize                                                               |
| `checkout.session.async_payment_failed`    | release the stock, order FAILED                                        |
| `checkout.session.expired`                 | release the stock, order EXPIRED                                       |
| `charge.refunded`                          | synchronize the refunded amount and status                             |
| `refund.created`, `.updated`, `.failed`    | synchronize the refunded amount and status                             |

Every other verified event is acknowledged (200), recorded and ignored.

### Signature and idempotency

- `POST /api/stripe/webhook` reads the raw body (≤ 512 KB, hard limit) and
  verifies it with `Stripe.webhooks.constructEvent` and
  `STRIPE_WEBHOOK_SECRET`. The SDK enforces the default 5-minute timestamp
  tolerance, which limits replays of captured requests. A missing or invalid
  signature answers 400 and nothing is read or logged from the body. Without
  a configured secret the endpoint answers 503, so Stripe retries later.
- A verified event is only used to learn **which** session or payment
  changed. Its current state is then read from Stripe's API, so a stale
  snapshot in a late or reordered event can never be applied.
- **Event IDs** are stored in `stripe_events` (unique) inside the same
  transaction as the event's effects. A known event is answered 200 without
  work; simultaneous deliveries roll the loser back. Processing errors
  (Stripe unreachable, database errors) answer 500 without recording the
  event, so Stripe retries for up to three days; nothing is released
  meanwhile.
- **State-based effects.** Every change requires the order to be PENDING
  (locked `FOR UPDATE`) and its reservations ACTIVE, and moves both on in
  the same transaction. A replay, even under a new event ID, and
  reconciliation running at the same time find nothing left to do. A second
  guard rejects the transaction if the number of consumed reservations
  differs from what was read.

### Payment finalization (`syncCheckoutSession`)

The single implementation, used by the webhook and by reconciliation:

1. If no order has this session ID, record and ignore it, without calling
   Stripe (sessions from other integrations or `stripe trigger`).
2. Retrieve the session with `payment_intent.latest_charge` expanded.
3. In one transaction (`lock_timeout` 5 s, deadlock retry): lock the order;
   classify the session (`classifySession`) and act:

| Stripe state                                                      | Order is PENDING                    | Order is paid / closed                               |
| ----------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| complete + paid                                                   | **finalize** (below)                | no change                                            |
| complete + unpaid, PaymentIntent processing/action                | store the payment ID; keep the hold | no change                                            |
| complete + unpaid, PaymentIntent requires_payment_method/canceled | release, **FAILED**                 | no change                                            |
| expired                                                           | release, **EXPIRED**                | no change (a late expiry never touches a paid order) |
| open                                                              | no change                           | no change                                            |
| anything else (e.g. no_payment_required)                          | needs attention                     | no change                                            |

**Finalize**, all in the same transaction:

- Stripe's `amount_total` and currency must equal the order's total and
  SEK. A mismatch is a security/operational error: nothing changes.
- Customer data is validated from the session only (`fulfillmentDetails`):
  `customerName` from the shipping name (one value, outer whitespace removed,
  never split; the customer-details name only if no shipping name exists),
  email, optional phone, address line 1 (and 2), postal code, city, and the
  country must be SE. Values longer than their columns are refused, never
  truncated.
- Every reservation must be ACTIVE. The product rows are locked in id order
  (the same order as checkout), `stockOnHand` is reduced by each
  **reserved** quantity, and the reservations become CONSUMED. If an admin
  had lowered stock below the reservation meanwhile, stock stops at 0 and
  the shortfall is recorded in the audit entry; the payment is real, so the
  order is still paid.
- The order becomes PAID with `paidAt` (Stripe's charge time),
  `stripePaymentIntentId`, the customer fields and country SE.
  `fulfillmentStatus` stays NEW. Audit `MARK_ORDER_PAID` (system entry,
  no personal data).

**Needs attention.** A mismatch, missing customer data, reservations that are
no longer active, or Stripe reporting payment for a checkout HeavyCards
already closed leave the order unchanged: PENDING with its stock still
reserved, never a malformed paid order and never overselling. A
`PAYMENT_NEEDS_ATTENTION` audit entry is written once per order and problem,
and the error is logged with IDs only. The event is recorded (a retry would
not fix it); staff resolve it in the Stripe Dashboard and, from Milestone 12,
in the admin order view.

### Delayed webhooks and reservation expiry (correction of Milestone 8)

Milestone 8 released an attached reservation by time alone, 15 minutes after
the session's expiry. If Stripe accepted a payment before expiry but its
webhook arrived later than that (Stripe retries for days), the units became
sellable again before HeavyCards learned of the payment: a possible oversell.

Fix (targeted; the Milestone 8 flow is otherwise unchanged):

- `inventory_reservations.awaiting_payment` is set when the session is
  attached, together with the existing expiry extension.
- **When an ACTIVE reservation stops holding stock:** a provisional one
  (never handed to Stripe's payment page) at `expiresAt`; one awaiting payment
  **only when Stripe's outcome is applied**: paid → CONSUMED, expired or
  failed → RELEASED. Every availability query uses the shared rule
  (`holding = ACTIVE AND (awaiting_payment OR expires_at > now)`); the
  provisional cleanup skips held reservations.
- **Payment succeeded but its webhook is delayed:** the units stay reserved,
  so nobody else can buy them; when the webhook (or reconciliation) arrives,
  the order is finalized normally. Tested: a rival checkout hours later is
  refused as sold out, and the late event then finalizes without
  overselling.
- **Missed expiration/failure webhook:** reconciliation (below) asks Stripe
  once the reservation's `expiresAt` (session expiry + 15 minutes) has passed
  and applies the answer through the same `syncCheckoutSession`.
- **Stripe unavailable during reconciliation:** nothing is released; the
  order's next check is moved 15 minutes forward (`RECHECK_AFTER_MS`) and
  retried. The same applies while a delayed payment is still processing and
  for orders that need attention, so a stuck order never starves the others.
- The cost is that a reservation whose outcome Stripe cannot report holds its
  stock until it can; correctness wins over freeing stock early.
- Migration `20261002090000_payment_reconciliation` marked reservations of
  existing pending, attached checkouts as awaiting payment.

### Reconciliation

- `reconcileCheckouts` (`src/server/payments/reconcile.ts`) selects pending
  orders with a session whose held reservations are due (`expiresAt` passed),
  oldest first, at most 25 per run, and calls `syncCheckoutSession` for each.
  Outcomes paid, expired and failed end the hold; anything else (processing,
  open, needs attention, errors) postpones the next check. It has no
  scheduler dependency and is tested on its own.
- **Entry points:**
  - `GET /api/cron/reconcile-checkouts` for Vercel Cron, authorized by
    `Authorization: Bearer CRON_SECRET` (constant-time comparison; refused
    when no secret is configured). It also releases expired provisional
    holds and revalidates affected pages. `vercel.json` schedules it daily
    at 03:00 UTC, the most frequent schedule a Vercel Hobby plan accepts
    (more frequent schedules fail Hobby deployments; verified 2026-10-02).
    On Pro, use `*/15 * * * *`.
  - After every `/api/checkout` request (`after()`), up to 3 overdue
    checkouts are reconciled, so stock is freed while customers are active
    even with a daily cron.
- Runs may overlap or repeat (Vercel Cron is best effort and may invoke
  twice): every step is idempotent under the order lock.
- Refunds are not reconciled: Stripe retries refund events for three days,
  and refunds change no inventory. A refund missed beyond that is visible in
  the Stripe Dashboard.

### Refund synchronization

- Any refund event leads to the payment's order (by
  `stripePaymentIntentId`). If the order is still PENDING or unknown (the
  refund overtook the payment event), the payment's session is found via
  Stripe and finalized first through `syncCheckoutSession`.
- The refunded amount is read from Stripe, never from the event: the sum of
  the payment's refunds whose status is **`succeeded`**
  (`succeededRefundTotal` in `src/server/domain/payment.ts`, used by both
  gateways). `refundedAmount` and the refund status therefore record money
  actually returned, never money that might still be returned:
  - `pending` and `requires_action` refunds do not count yet. The later
    `refund.updated` (or `charge.refunded`) event re-reads the list, and the
    refund counts from the moment Stripe reports it succeeded;
  - `failed` and `canceled` refunds never count, so a refund that was pending
    or awaiting action and then failed or was cancelled never changed the
    order at all.

  Stripe's `charge.amount_refunded` is not used because its handling of
  pending and failed refunds is not documented. No extra payment state exists
  for a refund in progress; it is visible in the Stripe Dashboard.

- `refundState` on the succeeded total: 0 → PAID, the full total →
  REFUNDED, in between → PARTIALLY_REFUNDED. Transitions follow
  `PAYMENT_TRANSITIONS`, so a succeeded refund that later fails lowers the
  state again but never makes the order unpaid, and an old success event can
  never turn REFUNDED back into PAID.
- `refundedAmount` equals Stripe's succeeded total (capped at the order total
  to keep the CHECK invariant). Audit `SYNC_ORDER_REFUND` records each change;
  events that change nothing (e.g. a refund only pending) write no entry.
- **Refunds never change inventory** and never revalidate pages. Restocking a
  returned item stays an explicit staff decision (PROJECT.md §35).

### Confirmation page and the cart

- `/kassa/bekraftelse?session_id=…` reads the order by the unguessable
  session ID and shows only database state: processing (with an automatic
  re-read after 2, 6, 14, 29 and 59 seconds), paid (order number, products,
  quantities, total), refunded, expired or failed. It never calls Stripe and
  never shows a name, email, phone or address. It stays `noindex, nofollow`
  with `Referrer-Policy: no-referrer`. In production Stripe normally waits up
  to 10 seconds for the `checkout.session.completed` webhook before
  redirecting the customer, so the page is usually already paid.
- **Cart clearing** happens only for a paid order, only in the browser that
  started that checkout, and only once:
  - the page passes the SHA-256 of the order's checkout attempt ID (which
    reveals nothing else);
  - `CartStore.completePaidCheckout` hashes the attempt ID stored in this
    browser and compares;
  - on a match it subtracts the purchased quantities from the cart (lines
    reaching 0 are removed) and clears the stored attempt, so a reload or
    another tab cannot subtract again;
  - products or extra quantities added after checkout started stay.
  - Pending, expired, failed, cancelled and unknown orders never clear the
    cart, and another browser opening the link keeps its own cart.

### Revalidation

Finalization and released reservations change availability, so the
Milestone 7 targets are refreshed through `revalidateCatalog` (homepage,
listings, category and set pages, all product pages and the affected
products' own URLs), from the webhook and cron route handlers and the
checkout route's `after()` callback. Revalidation failures are logged and
never fail payment processing; at worst pages are stale for the 60 s ISR
window. Refunds revalidate nothing.

### Logging

`[payments]` log lines carry only the Stripe event ID and type, the
HeavyCards order ID, the outcome or problem code, and an error's
name/type/code/request ID. Never the body, signature, secret, customer name,
email, phone or address. Tests assert this for signature failures.

### Environment and configuration

- `STRIPE_WEBHOOK_SECRET` (`whsec_…`): validated; required in Vercel
  production.
- `CRON_SECRET` (≥ 16 characters): validated; required in Vercel production.
- `FAKE_STRIPE_STATE_DIR`: only with `PAYMENT_GATEWAY=fake` (E2E); refused
  otherwise.
- `vercel.json`: the daily reconciliation cron.
- No new dependencies. The Stripe client gained `sessions.list` and
  `refunds.list` calls; a restricted key therefore needs read access to
  Checkout Sessions, PaymentIntents, Charges (expanded) and Refunds in addition to
  writing Checkout Sessions.

### Testing

- **Unit:** the transition table (allowed and refused pairs, final states,
  paid states never unpaid), session classification, amount/currency checks,
  customer-data validation (name never split, no truncation, Sweden only),
  refund states, the inventory holding rule, the Stripe gateway mapping and
  refund summation, return-page states (no personal data, attempt hash), env
  rules, and cart clearing (only this browser's checkout, once, later
  additions kept, no Web Crypto → no change).
- **DB** (`tests/db/payments.test.ts`, real PostgreSQL, signed events):
  valid, wrong-secret, replayed-timestamp, tampered and unsigned webhooks;
  unconfigured secret; unrelated events and unknown sessions; duplicate
  event IDs, six simultaneous duplicate deliveries, different events plus
  reconciliation racing; Stripe unreachable (500, nothing recorded, still
  reserved, retry succeeds); full finalization (stock, CONSUMED, customer
  fields, identifiers, audit without personal data, revalidation); success
  replay; amount and currency mismatch; five kinds of missing or invalid
  customer data; no phone; stock shortfall; expiry before payment and
  repeated; late expiry after payment; delayed payment success and failure
  (with a stale replay); an open session; partial, full, replayed,
  reordered, failed and early refunds, never restocking; refunds for unknown
  payments; **the delayed webhook after the nominal expiry with a rival
  customer refused**; a lost paid webhook finalized by reconciliation; a
  missed expiry released, twice idempotently; Stripe unavailable during
  reconciliation (postponed, still reserved, resolved later); a delayed
  payment postponed; only due checkouts checked; reconciliation racing a
  webhook; the cron handler's authorization. Also a replay of the new
  migration on pre-existing rows.
- Mutation checks during development: reverting the holding rule to
  Milestone 8's time-only rule makes the delayed-webhook, missed-expiry and
  delayed-payment tests fail; removing the PENDING/ACTIVE guards makes the
  concurrent-delivery tests fail.
- **E2E** (`checkout` project): a verified payment shows the confirmation
  with products and total, no personal data, stock reduced, reservation
  consumed and the cart cleared (and not cleared again on reload); only
  purchased items are cleared; another browser keeps its cart; the pending
  page updates by itself after the webhook; expired and failed delayed
  payments are shown honestly with the cart kept; forged and unsigned
  webhooks are refused; the reconciliation route is not public; axe checks.

### Production Stripe setup still required (Milestone 15)

- Create the webhook endpoint `https://<domain>/api/stripe/webhook` in live
  mode with the eight events above; store its signing secret as
  `STRIPE_WEBHOOK_SECRET` (and a separate test-mode endpoint and secret for
  previews if they take test payments).
- Set `CRON_SECRET` in Vercel; on a Pro plan tighten the cron to every 15
  minutes.
- If a restricted key is used, grant it the reads listed above.
- Decide who monitors `PAYMENT_NEEDS_ATTENTION` entries until the admin order
  view (Milestone 12) shows them.

## Milestone 10 — Transactional email (2026-10-02)

Customer emails for paid and shipped orders, on the Milestone 6 Resend
foundation. Schema details are in [database.md](database.md). Review links
are Milestone 11; the admin order UI is Milestone 12.

### Layers

| Layer                                                                     | Module                                     |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| Transports (Resend, console, file, memory), failure classification        | `src/lib/email/transport.ts`               |
| Email-safe HTML building blocks                                           | `src/lib/email/html.ts`                    |
| Order confirmation and shipping templates (pure, from order snapshots)    | `src/server/email/order-templates.ts`      |
| Delivery rules: keys, backoff, provider window, eligibility (pure)        | `src/server/domain/email-delivery.ts`      |
| Outbox: enqueue, claim/dispatch, retry, sweep                             | `src/server/email/outbox.ts`               |
| Wiring to the configured transport; dispatch after the response           | `src/server/email/server.ts`               |
| Fulfillment transition service (creates the shipping obligation)          | `src/server/orders/fulfillment.ts`         |
| Integration points: payment finalization, webhook, cron, checkout `after` | `src/server/payments/*`, `src/app/api/...` |

### Outbox, not "send in the transaction"

1. **Obligation.** The business transaction inserts an `EmailDelivery` row:
   - `finalizePaid` (the one place an order becomes PAID, webhook or
     reconciliation) inserts the `ORDER_CONFIRMATION` row;
   - `transitionFulfillment` inserts `ORDER_SHIPPED` on the first SHIPPED.

   The row commits or rolls back with the state change. Unique
   `(order_id, kind)` plus `ON CONFLICT DO NOTHING` makes a second obligation
   impossible, and never aborts the caller's transaction.

2. **Dispatch.** `dispatchEmailDelivery` runs outside any transaction:
   - **claim:** one atomic `UPDATE … WHERE status = 'PENDING' AND due AND
lease free RETURNING`, which takes a 2-minute lease and increments
     `attempts` (also the token that proves the lease);
   - **render** from the order as stored, and re-check eligibility;
   - **send** with the idempotency key;
   - **record**, guarded by the attempt number: SENT plus the order's
     `*EmailSentAt` marker in one transaction, or the failure.

3. **One dispatcher, three triggers.** All three call the same code:
   - **Immediately:** the webhook route schedules
     `processDueEmails({ orderId })` with Next's `after()` when an order
     became paid. Stripe gets its 200 without waiting for Resend.
   - **Scheduled:** the cron route's email step runs the sweep, then every
     due delivery (25 per run).
   - **Piggyback:** up to 3 due emails after each checkout request (its
     existing `after()`), so retries keep moving between daily cron runs.

### Exactly once for the customer

| Scenario                                                     | Why only one email                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Duplicate or redelivered Stripe success, reconciliation race | M9 finalizes once (PENDING guard under the order lock); unique `(order_id, kind)`                                              |
| Concurrent dispatchers (after(), cron, checkout)             | Only one `UPDATE` can take the lease; the others match no row                                                                  |
| Repeated runs after success                                  | A SENT row is never claimed again                                                                                              |
| Repeated or concurrent "mark shipped"                        | Order row lock; same status is a no-op; SHIPPED is reachable once; unique row                                                  |
| Provider timeout, 5xx, network error                         | Retried with the **same** idempotency key; Resend returns the first email instead of sending again                             |
| Crash after the provider accepted, before recording          | The lease lapses; the next claim marks the outcome unknown and retries with the same key                                       |
| Outage longer than Resend's 24-hour key memory               | No blind retry: once 23 hours have passed since the first unknown outcome, the row becomes FAILED and staff decide (see below) |

**Idempotency keys** are `order-confirmation/<order id>` and
`order-shipped/<order id>`. They are deterministic, so a retry, another process
or another run uses the same key. Resend's own rules (verified against its
documentation on 2026-10-02):

- keys are kept for 24 hours and may be up to 256 characters;
- the same key with the same payload returns the original email ID;
- the same key with a different payload answers 409
  `invalid_idempotent_request`;
- a concurrent request with the same key answers 409
  `concurrent_idempotent_requests`.

The rendered message is deterministic (items in a fixed order, dates from
the stored payment time), so a retry has the same payload.

### Failure classification and retries

`classifyResendError` maps a failed send:

| Failure    | Examples                                                                        | Handling                                         |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `not_sent` | 4xx validation, invalid sender or key, 429 rate limit or quota                  | retry with backoff                               |
| `unknown`  | network error, our 15 s timeout, 5xx, `concurrent_idempotent_requests`, crash   | retry with the same key while the window is open |
| `conflict` | `invalid_idempotent_request` (the key was used with a different message before) | FAILED at once: the first one may have arrived   |

- **Backoff:** 1 min, 5 min, 15 min, 1 h, 3 h, 6 h; 7 attempts in total
  (about 10 hours), then FAILED. The whole schedule fits inside the 23-hour
  window.
- **Escalation:** FAILED writes an `EMAIL_NEEDS_ATTENTION` system audit
  entry (kind, problem, attempts; no personal data) and logs an error.
  Nothing is retried in a tight loop: a row is attempted only when due, and
  each trigger processes a bounded batch.
- **Business state is never touched by a failure:** the order stays PAID or
  SHIPPED, and the delivery stays PENDING (retryable) or becomes FAILED.

### Eligibility when sending

The order is re-read at send time:

- **Confirmation:** only for PAID or PARTIALLY_REFUNDED orders. A fully
  REFUNDED order (refunded before the email went out) gets CANCELLED
  instead of a "thank you for your order".
- **Shipping:** only for SHIPPED or COMPLETED orders.
- **Already marked:** an order whose `*EmailSentAt` marker is already set is
  CANCELLED (`already_sent`).
- **Recipient:** always `orders.email` of the finalized order. No API,
  action or parameter accepts a recipient, and nothing customer-facing can
  trigger a send or a resend. The `/kassa/bekraftelse` page only reads.

### Orders paid before Milestone 10

`enqueueMissingOrderConfirmations` (the first part of the scheduled email
step) finds orders that:

- are PAID or PARTIALLY_REFUNDED;
- have `confirmation_email_sent_at` NULL;
- have no confirmation row.

It inserts their obligation (`ON CONFLICT DO NOTHING`, so concurrent sweeps
are safe), and the normal dispatcher sends it once. No Stripe event is
needed. Fully refunded and unpaid orders are skipped. The development seed
already sets `confirmationEmailSentAt` on its paid orders, so they are not
mailed. Orders that shipped before Milestone 10 get no shipping email.

### Fulfillment transitions (shared with Milestone 12)

`transitionFulfillment(db, { actorId, input, now })` is the only writer of
`fulfillmentStatus`. Milestone 12's admin actions call it and then
`processDueEmails({ orderId })` in `after()`; the tests call it directly.

- Input is Zod-validated: target status; the tracking number is trimmed,
  ≤ 100 characters, and only letters, digits, space and `- . / _`; carrier.
- In one transaction (`lock_timeout` 5 s, deadlock retry):
  - re-check the actor (active, `canManageOrders`, `FOR SHARE`);
  - lock the order;
  - validate the transition and the payment precondition;
  - update the order and audit `UPDATE_ORDER_STATUS`.
- **First SHIPPED** additionally sets `shippedAt`, keeps or sets the tracking
  number and carrier, and enqueues `ORDER_SHIPPED`.
- **Same status again** is a no-op returning `changed: false`. On a SHIPPED
  order it may correct tracking details (`UPDATE_ORDER_TRACKING`) and never
  emails.
- **Results:** `INVALID_INPUT`, `NOT_FOUND`, `INVALID_TRANSITION` and
  `PAYMENT_NOT_SETTLED`; `ForbiddenError` for actors who may not manage
  orders.
- Email delivery can never decide whether the transition succeeds.

### Templates

- **Confirmation** (subject `Orderbekräftelse HC-10001`):
  - wordmark, greeting by full name;
  - "payment received, we email you when it ships" (it never claims the
    order has shipped);
  - order number and date (payment time, Stockholm);
  - each line from `OrderItem` snapshots: name, quantity × unit price, line
    total;
  - subtotal, shipping ("Fri frakt" at 0), total, VAT contained;
  - delivery address, carrier;
  - customer service (reply-to `StoreSettings.contactEmail`, `mailto:` link,
    `/kontakt`); footer with company name and org.nr when configured.
- **Shipped** (subject `Din beställning HC-10001 har skickats`):
  - "your order is on its way";
  - carrier (PostNord only; "OTHER" is not named);
  - tracking number only when present, shown as text with no tracking URL;
  - items with quantities, delivery address, support.
- **Review slot:** `orderShippedEmail(order, store, { review: { url } })`
  renders a "Vad tyckte du?" section with a button. Milestone 11 supplies the
  secure URL; until then no section is rendered.
- **Markup:** nested presentation tables, inline styles, Arial/Helvetica,
  max 600 px, black/white/grey, no images, scripts, classes or external CSS.
  Every value is HTML-escaped. A plain-text part mirrors the content.
- **Logo:** the official mark exists only as an SVG rendered through a CSS
  mask, which Gmail and Outlook do not support. The emails use a
  `HEAVYCARDS` text wordmark instead of a redrawn or rasterised logo. A PNG
  export of the official mark can replace it later without other changes.
- **No identifiers:** no internal IDs or Stripe identifiers appear in emails.

### Environments

The Milestone 6 modes are unchanged:

- **Vercel production:** Resend, required.
- **Elsewhere:** `console` by default.
- **E2E:** `file`.
- **DB tests:** an injected memory transport.

Additions:

- **Provider idempotency in every transport.** The `file` transport writes
  one file per idempotency key and returns the first result for a repeated
  key, like Resend; the memory transport does the same and also records
  every call.
- **Console output:** order emails carry `personalData: true`, so the
  console transport logs only the masked recipient, the subject and the key,
  even in development. Admin emails keep printing their link in
  development.
- **Env validation:**
  - `RESEND_API_KEY` must look like `re_…`;
  - `EMAIL_FROM` must be `address` or `Name <address>`;
  - in Vercel production the sender domain must not be a placeholder
    (`example.*`, `.invalid`, `.test`, `.local`, `resend.dev`);
  - `EMAIL_TRANSPORT=resend` is refused when `NODE_ENV=test`, so an
    automated test run can never email anyone, whatever `.env.local` says.
- **Resend calls:** each has a 15-second timeout (the SDK has none). Resend
  error messages are never stored or logged, only their name.

### Scheduling

`GET /api/cron/reconcile-checkouts` now coordinates two independent steps,
each in its own error boundary:

1. payment reconciliation (unchanged);
2. emails: sweep, then due deliveries.

- Payments run first, so orders they finalize are confirmed in the same run.
  An email failure never affects payments, and the email step still runs
  when payments are not configured or fail. The response adds an `emails`
  summary.
- On Vercel Hobby the cron is daily. Retries then depend on the
  after-checkout and after-webhook triggers. During a long quiet period an
  unknown outcome can outlive the 23-hour window and go to FAILED rather
  than risk a duplicate.
- On Pro, `*/15 * * * *` keeps the whole retry schedule automatic
  (Milestone 15).

### Logging and privacy

- `[email]` log lines (via the shared `logSafe`, also used by `[payments]`
  now) carry only:
  - delivery and order IDs, kind, attempt, outcome;
  - error and problem codes, and the Resend email ID on success.
- They never carry the recipient, names, addresses, message content or keys.
  A DB test captures all console output over successful, failing, retried,
  shipped and conflicting sends and asserts this; it also checks the audit
  metadata.
- The outbox stores no message content and no recipient.

### Testing

- **Unit:**
  - transports: Resend through a mocked `fetch` (idempotency header,
    reply-to, classification of nine error kinds, network failure,
    timeout; the API key and recipient never appear in errors), idempotent
    file and memory transports, console redaction;
  - templates: Swedish content, historic amounts, free shipping, the
    optional address line, support and company details, no shipped claim
    in the confirmation, escaping, email-safe markup, tracking only when
    present, no fabricated tracking URL, the review slot, no IDs;
  - delivery rules (keys, backoff, window, eligibility);
  - the payment precondition for fulfillment;
  - env rules.
- **DB** (`tests/db/transactional-email.test.ts`, real PostgreSQL, signed
  webhooks, fake Stripe):
  - **Confirmation obligation:** one confirmation obligation per paid order
    and none sent inside the webhook; duplicate, redelivered and concurrent
    successes; reconciliation racing the webhook; no obligation when
    finalization is refused; none for pending, expired or failed orders.
  - **Delivery:** the recipient is the order's email; snapshots after a
    product rename and price change; retryable failure and later success;
    no provider call after SENT.
  - **Provider failures:** an accepted-then-timed-out send deduplicated by
    the key; a multi-failure outage; the 23-hour window; crash recovery
    through the lapsed lease; max attempts; idempotency conflict.
  - **Concurrency:** 11 concurrent dispatchers producing one call.
  - **Refunds:** refunded before sending (cancelled) and partially refunded
    (sent).
  - **Orders paid before M10:** the sweep sends once, concurrent sweeps
    create one row, confirmed, refunded and unpaid orders are skipped.
  - **Shipping:** first SHIPPED (status, shippedAt, audit, obligation,
    email with tracking), repeated and concurrent SHIPPED, tracking
    correction, no tracking section, COMPLETED sends nothing, a mail failure
    does not block shipping; invalid transitions, unpaid orders and bad
    input; inactive administrators.
  - **Cron and privacy:** an email outage during reconciliation, emails
    without a payment gateway; log and audit privacy; schema constraints.
- **Mutation checks during development:** each of these makes the named
  tests fail:
  - removing the lease condition: the race tests;
  - removing the window check: the window test;
  - removing the enqueue from `finalizePaid`: the obligation and dispatch
    tests;
  - removing the PENDING guard: the "never again once SENT" test.
- **E2E** (`checkout` project): a real webhook (three deliveries), then
  `after()` and the file outbox:
  - one SENT delivery with one attempt, and one email to the Stripe
    customer with the order number, product and address;
  - visiting the confirmation page while unpaid creates nothing.

  Shipping is not covered in the browser until the Milestone 12 UI exists.

### Dependencies

None added. `resend` 6.31.0 (Milestone 6) already supports
`idempotencyKey` on `emails.send`.

### Production Resend setup still required (Milestone 15)

1. In Resend, add and verify the sending domain, e.g. `heavycards.se` or a
   subdomain such as `mail.heavycards.se`. Add the SPF (MX/TXT) and DKIM
   (TXT/CNAME) records Resend shows, and preferably a DMARC record
   (`_dmarc`, start with `p=none`). Wait until Resend reports the domain as
   verified.
2. Create an API key with **Sending access** only, restricted to that
   domain. Set it as `RESEND_API_KEY` in Vercel **Production** only. Use a
   separate key, or none, for previews.
3. Set `EMAIL_FROM` to an address on the verified domain, e.g.
   `HeavyCards <order@heavycards.se>`. Production refuses placeholder
   domains.
4. Set `StoreSettings.contactEmail` to the real customer-service mailbox;
   it is the reply-to address and is shown in every email.
5. Send a test order in Stripe test mode on a preview with Resend
   configured, and check rendering in Gmail (web and app), Outlook and
   Apple Mail.
6. Decide who watches `EMAIL_NEEDS_ATTENTION` audit entries until the
   Milestone 12 order view shows them. To resend a FAILED email after
   checking in the Resend dashboard that it was not delivered, set its row
   back to `PENDING` with `next_attempt_at = now()` (a deliberate operator
   action). An explicit resend feature is out of scope for V1.
7. On a Vercel Pro plan, schedule the cron every 15 minutes.

## Milestone 11 — Verified purchase reviews (2026-10-02)

Customers review what they bought through the link in the shipping email.
Schema details are in [database.md](database.md), the route in
[routes.md](routes.md). The admin review screens are Milestone 12; this
milestone provides the moderation service they will call.

### Layers

| Layer                                                                | Module                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Token derivation, expiry, link path (pure, server-only)              | `src/server/domain/review-token.ts`                                        |
| Review rules: moderation transitions, which orders allow reviews     | `src/server/domain/review.ts`                                              |
| Input schema and text normalization (browser and server)             | `src/lib/validation/reviews.ts`                                            |
| Invitations: create at SHIPPED, render the link, resolve a URL token | `src/server/reviews/invitations.ts`                                        |
| Submission (the one write path for customer reviews)                 | `src/server/reviews/submit.ts`                                             |
| Moderation service; wiring with revalidation and the review key      | `src/server/reviews/{moderation,server}.ts`                                |
| Integration: first SHIPPED, shipping email                           | `src/server/orders/fulfillment.ts`, `src/server/email/outbox.ts`           |
| Page, server action, form, star input                                | `src/app/(store)/review/[token]/*`, `src/components/store/review-form.tsx` |
| Public display (Milestone 4 queries and components, unchanged)       | `getProductBySlug`, `ProductReviews`, product JSON-LD                      |

### Invitation and entitlement model

- **One invitation per shipped order** (the existing `ReviewToken` model,
  now unique per order). It is the single link in the shipping email and
  opens one page listing that order's purchased products, each with its own
  form (PROJECT.md §46).
- **One entitlement per order line.** Every line of a shipped order is
  eligible; V1 excludes no product types. Buying 3 of a product is one line
  and one review. The entitlement is consumed by the `Review` row itself
  (unique `order_item_id`), so there is no separate entitlement table:
  inserting the review is the atomic consumption.
- **Scoping.** The form posts the token and the line's ID. The server finds
  the invitation by token hash and accepts only a line of _that_ order;
  product, verified flag and status come from the server. Another order's
  line, an unknown ID or extra fields (product ID, status) cannot change
  what is reviewed.
- **Historical integrity.** The review references the `OrderItem` and its
  product; the page shows the purchase-time name snapshot. Renaming,
  re-slugging, repricing or archiving the product changes nothing (tested).
- **Closing.** When every line has a review, the link is fully used and
  gets the generic "cannot be used" page. Deleting a review (a Milestone 12
  decision) would make that line reviewable again while the link is valid;
  rejecting does not. Milestone 12 should prefer rejection.

### Token: stable across email retries, never stored

The outbox renders the shipping email at send time and may send it several
times under one Resend idempotency key, which requires an identical payload
(Milestone 10). Minting a token per render would break that; storing the raw
token to rebuild the URL would put usable links in the database. Design:

```
nonce     = 32 random bytes (crypto.randomBytes), stored as base64url
key       = HKDF-SHA256(AUTH_SECRET, salt "heavycards", info "heavycards/review-link/v1")
rawToken  = HMAC-SHA256(key, "review-token:" + nonce), base64url, 43 characters
tokenHash = SHA-256(rawToken), stored, unique
```

- **Retries:** every render re-derives the same URL from the stored nonce;
  no render mints a token. Tested: a timeout, a refusal and a success send
  three identical messages under one key, and one invitation exists.
- **Database leak:** nonce and hash alone produce nothing usable; the key
  exists only in the environment. Neither the hash nor the nonce works as a
  URL token (tested in DB and E2E).
- **Strength:** an HMAC with a secret key over a 256-bit CSPRNG nonce is
  indistinguishable from 256 random bits. Someone holding **both** the
  database and `AUTH_SECRET` can derive links. That is inherent to
  re-rendering an email without storing its content, and such an attacker
  could already forge admin sessions.
- **Verification** never needs the key: the URL token is format-checked,
  hashed and looked up through the unique index (no comparison in code).
- **Rotating `AUTH_SECRET`:** delivered links keep working (lookup is by
  hash). A shipping email still waiting to be sent goes out without the
  review section: the render compares the derived token with the stored
  hash and logs `review_link_key_mismatch` instead of sending a dead link.
  If an earlier attempt had already gone out with the link, Resend answers
  "different payload" and the delivery becomes FAILED for staff (Milestone
  10 rule); this only matters for a rotation in the middle of an outage.
- **Lifetime:** 180 days from shipping (`REVIEW_TOKEN_TTL_DAYS`; PROJECT.md
  §44 suggests about 180): enough for delivery and a considered review
  weeks later, but not permanent. Expired, revoked, fully used, malformed
  and unknown links all get the same Swedish page.

Alternatives rejected: encrypting the raw token (same security, more moving
parts); one link per line in the email (cluttered, and N tokens to keep
stable); storing the rendered email (stores the token).

### Creation with the first SHIPPED

`transitionFulfillment` now takes `reviewLinkKey` (in production
`reviewLinkKey` from `src/server/reviews/server.ts`; Milestone 12's actions
pass it). On the first SHIPPED, inside the existing transaction with the
order row locked, it inserts the invitation (`ON CONFLICT DO NOTHING` on the
unique order) and then the `ORDER_SHIPPED` email obligation. Both commit or
roll back together, so an email can never point to a missing invitation.

- SHIPPED is reachable once, so repeated, concurrent or later transitions
  (tracking correction, COMPLETED) never mint another invitation; the unique
  index is the backstop. Tested with six concurrent SHIPPED submissions.
- Unpaid, pending, failed, expired, cancelled and fully refunded orders
  cannot reach SHIPPED (Milestone 10 precondition), so they never get one.
- **Orders shipped before this milestone** get no invitation and no email.
  Nothing is backfilled, the scheduled sweep only covers confirmations, and
  a shipping email still owed from before is sent with its original content
  (no review section). A future backfill would need an explicit decision
  about contacting those customers.

### Submission

`submitReview` (called by the server action):

1. Zod-validates the input (below); the rating is an integer 1–5.
2. In one transaction: the invitation by token hash `FOR SHARE` (so a
   future revocation waits), usable (not expired, not revoked), its order
   paid (PAID, PARTIALLY_REFUNDED or REFUNDED) and shipped, and the line
   part of that order with no review yet.
3. Inserts the review: PENDING, `verifiedPurchase = true`, the line's
   product, and the typed display name or "Verifierad kund".

A double click, retry, second tab or concurrent request either sees the line
reviewed or loses on the unique index (P2002 → `ALREADY_REVIEWED`); exactly
one review exists (tested with ten concurrent submissions). The form also
ignores clicks while a submission is pending.

**Text rules** (`src/lib/validation/reviews.ts`, shared by browser and
server): Unicode NFC; CRLF → LF; zero-width and bidirectional-override
characters removed; spaces collapsed; at most one empty line in a row;
trimmed; other control characters refused. Body 10–2 000 characters, title
up to 100 (optional), display name up to 40 (optional, one line, no `@`,
`://` or `www.`). Lengths count code points. Raw fields over 8 000
characters are refused before normalization, and Next caps action bodies at
1 MB. Reviews are stored and rendered as plain text (React escapes them;
`whitespace-pre-line` keeps paragraphs); nothing is parsed as HTML or
Markdown.

**Public identity.** PROJECT.md §42 lists a display name as review content
but defines no format. The customer may type one ("Namn som visas
(valfritt)", e.g. a first name); blank shows "Verifierad kund". Nothing is
derived from the order: `customerName` is never split, and email, address
and order number are never shown or published. "Verifierat köp" remains
the badge (unchanged component), so it is not also used as the name.
Moderation is the safeguard if a customer types their full name.

**Refunds** neither delete a submitted review nor issue a new invitation,
and a refund after shipping does not withdraw the link (the customer did
buy and receive the product). Moderation decides what is published.

### Page and form

- `/review/[token]` renders per request (it reads `headers()` for the rate
  limit) and is never cached. It shows the purchased products (snapshot
  name, current first image, quantity) with one form each, a privacy note,
  and a thank-you for reviewed lines. Nothing about the customer is shown.
- Unusable links get one page, "Länken kan inte användas", with HTTP 200
  and identical text for every cause (tested in E2E), so it reveals nothing
  about orders.
- The form is a client component: a native radio group for the stars
  (arrow keys, spoken labels such as "4 stjärnor av 5", visible focus, 44 px
  targets), labelled fields with hints and Swedish errors linked through
  `aria-describedby`, and `role="status"` for the result. With JavaScript it
  submits from a transition, so a server-side error never clears the
  customer's text (React resets forms after native form actions); without
  JavaScript the same server action works as a plain form post.

### Moderation

`moderateReview(db, { actorId, input })` (`src/server/reviews/moderation.ts`):

- Input `{ reviewId, decision: APPROVE | REJECT }`, Zod-validated.
- One transaction: the actor re-checked `FOR SHARE` (active and
  `canManageReviews`, i.e. OWNER or ADMIN per PROJECT.md §50, otherwise
  `ForbiddenError`); the review locked `FOR UPDATE`; the transition checked:
  PENDING → APPROVED/REJECTED, APPROVED → REJECTED (unpublish), REJECTED →
  APPROVED, never back to PENDING.
- Audit `APPROVE_REVIEW` / `REJECT_REVIEW` with `{ from, to, productId }`,
  never the text or customer data. Repeating a decision is a no-op without
  an audit entry (tested with six concurrent approvals: one change, one
  entry).
- Returns `revalidatePaths`: the product page, when the change touched
  APPROVED (the only public state). `moderateReviewAndRevalidate`
  (`src/server/reviews/server.ts`) runs the service and refreshes those
  paths; a failed refresh is logged and never fails the decision. Product
  cards and listings show no ratings, so only the product page is refreshed.
- Not built (Milestone 12): the `/admin/reviews` screens, the dashboard's
  pending count, deletion.

### Public ratings

The Milestone 4 architecture is unchanged: `getProductBySlug` loads the
newest 20 APPROVED reviews and the APPROVED-only count and average;
`ProductReviews` renders them (with an empty state), and product JSON-LD
includes AggregateRating only when approved reviews exist. Tested: pending
and rejected reviews never appear or count; approving ratings 5 and 2 gives
3.5 from 2 reviews.

### Security and privacy

- **Headers:** `/review/**` sends `X-Robots-Tag: noindex, nofollow` and
  `Referrer-Policy: no-referrer` (next.config.ts); the page also sets the
  `robots` and `referrer` meta tags. Responses are `no-store`. The page
  loads no third-party resources (self-hosted font; images through
  `/_next/image` on our own origin), and there is no analytics.
- **No redirects** carry the token anywhere.
- **Rate limits** (PostgreSQL buckets per HMAC'd client IP): 60 page views
  and 20 submissions per 10 minutes. With 256-bit tokens they cap load and
  spam; they are not what prevents guessing.
- **CSRF:** the action uses no cookie or session, so a cross-site form could
  only use a token its author already has. Next.js also refuses actions
  whose `Origin` differs from the host.
- **Logging:** the token is never logged, audited or stored. Errors are
  logged by name only (`logSafe`). A DB test captures all console output
  over shipping, email retries, page lookup, submissions and moderation, and
  searches it and every relevant table for the token. The console email
  transport never prints order emails (Milestone 10).
- **Known limit:** as with admin invitation and reset links, the token is in
  the URL, so hosting access logs (Vercel) can record it. Access to those
  logs is an operational control (Milestone 15).

### Testing

- **Unit:** token derivation (stable, unique, unusable without the key,
  hash and nonce rejected, 180 days); the input schema and normalization
  (ratings, lengths in code points, oversized input, control characters,
  HTML kept as text, extra fields stripped); moderation transitions and the
  public-state rule; order eligibility; the revalidating wrapper.
- **DB** (`tests/db/reviews.test.ts`; real PostgreSQL, real fulfillment and
  outbox, link taken from the email): invitation creation and uniqueness
  (repeated, concurrent, later transitions; unshippable orders); one URL
  across retries; key rotation; orders shipped before this milestone;
  generic answers for invalid, hash, nonce, order ID and email; expired,
  revoked and consumed links; foreign lines and product substitution;
  double and concurrent submissions; quantity 3; several products;
  renamed and archived products; refunds; ratings; moderation
  authorization, audit, concurrency and revalidation paths; token privacy
  in logs and tables. Updated: the Milestone 10 shipping test now expects
  the link, and integrity tests cover the new constraints.
- **Mutation checks during development:** removing the unique-violation
  handling fails the concurrency test; dropping the order scope from the
  line lookup fails the substitution test; rendering shipping emails
  without the link fails 30 tests.
- **E2E** (`reviews` project, after `checkout`): shipping-email link → page
  (headers, noindex, no personal data, axe) → Swedish browser validation →
  keyboard rating → submit → pending review in the database → second
  product → link closed on reload; a second tab cannot review again;
  unknown, malformed, hash, nonce, order-ID, tampered and expired links give
  one identical page; a pending review stays off the product page until
  approved, then shows with "Verifierat köp"; phone layout. Staff actions
  run the real services through `e2e/support/review-actions.ts` (tsx with
  the `react-server` condition), because the admin screens are Milestone 12. The approval therefore appears through the 60 s ISR window rather
  than on-demand revalidation, which the unit test covers.

### Dependencies

None added.

## Milestone 12 — Admin dashboard, orders, reviews and store settings (2026-10-02)

The day-to-day control panel on top of the Milestone 6–11 services. Routes
are in [routes.md](routes.md); audit actions, the new index and the
merchant-editable settings in [database.md](database.md). The only schema
change is one index.

### Layers

| Layer                                                                | Module                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Database re-check of the acting administrator (reads and writes)     | `src/server/admin/access.ts`                                        |
| Server-action guard (session, role, error hiding)                    | `src/server/admin/action-guard.ts`                                  |
| Dashboard aggregates                                                 | `src/server/admin/dashboard.ts`                                     |
| Order list parameters, list and detail queries                       | `src/server/admin/orders/{list-params,queries}.ts`                  |
| Swedish labels, attention and history sentences (pure)               | `src/server/admin/orders/presenters.ts`                             |
| Needs-attention model and "mark handled"                             | `src/server/admin/orders/attention.ts`                              |
| Fulfillment form → `transitionFulfillment` (Milestone 10)            | `src/server/admin/orders/fulfillment-form.ts`                       |
| Stripe Dashboard links                                               | `src/server/admin/orders/stripe-links.ts`                           |
| Review list (moderation is the Milestone 11 service)                 | `src/server/admin/reviews/queries.ts`                               |
| Settings schema (browser and server), settings service, revalidation | `src/lib/validation/store-settings.ts`, `src/server/admin/settings` |
| Server actions                                                       | `src/app/admin/(panel)/{orders,reviews,settings}/actions.ts`        |
| Pages and components                                                 | `src/app/admin/(panel)/*`, `src/components/admin/*`                 |

No domain logic was duplicated. Fulfillment transitions, the payment
precondition, `shippedAt`, the review invitation and the shipping-email
obligation stay in `transitionFulfillment`; moderation rules, audit and
revalidation paths in `moderateReview` / `moderateReviewAndRevalidate`.
Pages only call the pure domain helpers (`allowedFulfillmentTransitions`,
`fulfillmentAllowedForPayment`, `canModerate`) to decide which buttons to
offer; the services validate every submission again.

### Authorization

- **Rules** (`src/lib/auth/authorization.ts`): `canManageOrders` and
  `canManageReviews` (OWNER and ADMIN, PROJECT.md §50, unchanged) and the new
  `canManageStoreSettings` (OWNER only: the "sensitive store settings" of
  §50). Every administrator may _read_ the settings (useful when answering
  customers); ADMIN sees a read-only summary without the form.
- **Pages** call `requireAdmin()` and render a 403 panel when the rule fails.
- **Actions** run through `runAdminAction`:
  - no session → login redirect;
  - wrong role → Swedish error, and the service is never called;
  - a ForbiddenError from the service → the same message;
  - anything else → a generic message, logged by error name only.
- **Services re-check in the database.** Writes lock the actor `FOR SHARE`
  inside their transaction (`lockActiveAdmin`, as in Milestones 7–11). New in
  this milestone: the order, dashboard, review-list and settings _reads_
  also re-check the actor (`assertActiveAdmin`, one indexed query), because
  they return customer data. A deactivated account is refused even if its
  session were still accepted, and the services are safe to call on their
  own.
- Session expiry, inactive rejection, the last-OWNER guard and CSRF are the
  Milestone 6 mechanisms, unchanged. The new actions are server actions, so
  Next.js's Origin/Host check applies.
- Navigation shows links by the same rules, as a convenience only.

### Dashboard (`/admin`)

Operational information first (PROJECT.md §52), no charts:

- **Kräver åtgärd**: open needs-attention items (below), counted per kind,
  with the latest ten linked to their orders, or an explicit "nothing needs
  attention" line.
- **Att göra** tiles linking to pre-filtered lists:
  - paid orders not started (NEW);
  - paid orders being handled (PROCESSING);
  - pending reviews;
  - published products at or below the low-stock threshold;
  - when non-zero: fully refunded orders still open (to be cancelled), and
    order emails waiting for a retry or overdue (scheduler idle for 30
    minutes).
- **Försäljning senaste 30 dagarna**: number of orders, amount paid,
  refunded and net. The definition is shown on the page:
  - orders whose _payment time_ falls in the last 30 days, with status PAID,
    PARTIALLY_REFUNDED or REFUNDED;
  - amounts include VAT and shipping;
  - net subtracts what has been refunded on those orders so far;
  - pending, failed and expired checkouts never count.

  Sums are computed in SQL as bigint.

- **Senaste beställningar** (8) and **Senaste orderhändelser** (8 audit
  entries rendered as sentences), plus the five lowest-stock products.

Every number is one aggregate query (`COUNT … FILTER`, `SUM`) over indexed
columns; the lists reuse the bounded order and product list queries. Nine
queries run in parallel, plus one batched order-number lookup for the
events. Nothing loads whole tables.

### Order list (`/admin/orders`)

- **Search** (`parseOrderSearch`):
  - "HC-10001", "hc10001" or "10001" → the public order number;
  - a `cs_…` or `pi_…` ID → that order;
  - anything else → all terms must match the name or email (`LIKE`,
    wildcards escaped).
- **Filters:**
  - payment status. The default is "everything except abandoned checkouts"
    (no EXPIRED); "betalda" means PAID or PARTIALLY_REFUNDED;
  - fulfillment status ("att hantera" = NEW or PROCESSING);
  - only orders needing attention. This overrides the default payment
    filter, because a payment for an abandoned checkout is exactly such a
    problem;
  - an order-date range in Stockholm calendar days
    (`AT TIME ZONE 'Europe/Stockholm'`, inclusive).

  Sorting: newest, oldest, highest amount. Invalid parameters are ignored,
  as on the product list.

- **Privacy**: rows show number, date, the customer's name, units,
  statuses, attention, total and refunded amount, but never email, phone or
  address. The detail page shows those.
- **One query per page**: lateral lookups for units and open attention, the
  total with `count(*) OVER ()`, 50 rows per page. A page past the end falls
  back to the last one.

### Order detail (`/admin/orders/[id]`)

- Number, created/paid/shipped times, payment and fulfillment status,
  customer name, email, phone, delivery address.
- Lines come from the `OrderItem` snapshots only (name, SKU, quantity, unit
  and line price, VAT rate), never from the current product. Then subtotal,
  shipping, total, VAT contained, refunded and net.
- Stripe Checkout Session and PaymentIntent IDs, and a link to the payment
  in the Stripe Dashboard (`/test/` unless the configured key is a live key;
  only well-formed `pi_` IDs are linked).
- Email state per kind from the outbox: status, attempts, sent time, next
  attempt, the stored error code and the Resend ID (never the recipient or
  content).
- The review invitation's creation and expiry dates only; the token, nonce
  and hash are never selected.
- Open attention items with Swedish explanations and guidance.
- History: the order's audit entries (oldest first, at most 200), rendered
  by `describeOrderEvent` from whitelisted fields. Raw metadata is never
  shown, so a metadata key added later cannot leak onto the screen.
- An unknown or malformed ID shows "Beställningen finns inte" inside the
  admin shell.

### Fulfillment

- The form posts to `transitionFulfillmentAction` → `submitFulfillmentForm`
  → `transitionFulfillment(db, { actorId, input, reviewLinkKey })` with the
  production `reviewLinkKey`. Tracking number and carrier are only sent for
  SHIPPED, so other transitions can never clear them.
- The UI offers exactly the domain's next steps:
  - NEW → "Markera som behandlas";
  - PROCESSING → carrier, optional tracking number, "Markera som skickad";
  - SHIPPED → "Spara spårningsuppgifter" and "Markera som slutförd";
  - cancelling (NEW or PROCESSING) needs a second confirmation and explains
    that nothing is refunded or restocked automatically.

  Unpaid orders cannot be processed or shipped (the service precondition,
  explained in Swedish).

- **Exactly once.** The first SHIPPED creates the invitation and the
  shipping-email obligation in the service's transaction. The action then
  schedules `sendOrderEmailsAfterResponse(orderId)` only when the service
  returned new obligations. Repeated saves are no-ops ("Inget att ändra");
  tracking corrections write `UPDATE_ORDER_TRACKING` and never email; the
  unique `(order_id, kind)` row is the backstop. No PostNord tracking URL is
  generated.
- The panel keeps one action state and stays mounted, so the result stays
  visible after the page refreshes into the next status.

### Refunds

Refunds are made in the Stripe Dashboard (PROJECT.md §34). The order shows
the refunded amount and status, a link to the payment, and the sentence
"Återbetalningar görs i Stripe Dashboard och synkas hit automatiskt".

- There is no refund button and no automatic restocking (§35). The page
  says to adjust the product's stock if a returned item can be sold again
  (the audited Milestone 7 stock edit).
- A fully refunded order that was never shipped shows up on the dashboard,
  so staff cancel it.

### Needs attention

- **Sources**, all recorded by earlier milestones as system audit entries:
  - `PAYMENT_NEEDS_ATTENTION`: amount or currency mismatch, missing customer
    data, payment for a closed checkout, unexpected session state;
  - `EMAIL_NEEDS_ATTENTION`: delivery FAILED (attempts exhausted, unknown
    outcome past the provider window, idempotency conflict);
  - `MARK_ORDER_PAID` with `stockShortfalls`: paid although stock had been
    lowered below the reservation.
- **Acknowledgement vs. an active condition.** A payment problem whose
  order still holds stock (an ACTIVE reservation awaiting Stripe's outcome)
  is an _active_ unsafe condition, not history: it blocks inventory.
  Everything else (email failures, stock shortfalls on paid orders, payment
  problems whose order no longer holds stock) is history that may be
  acknowledged.
- **Open** (`openAttentionSql(now)`) means no `RESOLVE_ORDER_ATTENTION`
  entry refers to the item, **or** it is a payment problem whose order still
  holds stock. So even a resolution written before this rule (or by hand)
  cannot hide an active hold. These states are final by design, so without
  an explicit acknowledgement the dashboard would show every historical
  problem forever.
- **"Markera som hanterat"** (OWNER/ADMIN) appends the resolution entry
  under the order row lock, so concurrent clicks give one entry. It changes
  nothing else: payment, stock and emails stay as they are, and the audit
  log stays append-only. For an active condition it is refused
  (`STILL_BLOCKING`, checked under the same order lock the payment service
  takes before it consumes or releases reservations), and the page shows
  why instead of the button.
- **"Kontrollera med Stripe igen"** (`recheckOrderPayment`, OWNER/ADMIN, for
  a pending order with a Checkout Session) is the way out. It re-checks the
  actor, then calls the Milestone 9 `syncCheckoutSession` exactly as
  reconciliation does, so Stripe's authoritative state decides:
  - paid and consistent → the existing finalization (stock consumed, order
    PAID, confirmation email sent after the response);
  - expired or failed → the existing release (reservations RELEASED, order
    EXPIRED/FAILED, storefront revalidated);
  - still inconsistent, processing or open → nothing changes; the stock
    stays reserved and the problem stays visible;
  - Stripe unreachable or not configured → nothing changes.

  Every recheck writes `RECHECK_ORDER_PAYMENT` with the outcome. There is
  no "release reservation" button, and no admin click ever releases stock.

- Each item explains what happened and what to do (check the payment in
  Stripe and refund there; check Resend and contact the customer), never
  "edit the database". Problem codes without a known text get a generic
  sentence.
- **Remaining limit:** if Stripe keeps reporting a state HeavyCards cannot
  accept (e.g. a paid amount that differs from the order), the hold remains
  and the problem stays open. Refunding in Stripe does not change the
  session's state; releasing such a hold remains a deliberate developer
  decision.

### Email state and resends

The order page and dashboard show the outbox state. A manual resend was
**not** added:

- a FAILED delivery may already have reached the customer (unknown outcome
  or idempotency conflict);
- after Resend's 24-hour key window, a resend cannot be deduplicated.

The page tells staff to check Resend and contact the customer directly. The
Milestone 10 operator procedure (setting the row back to PENDING after
checking Resend) remains the escape hatch.

### Reviews (`/admin/reviews`)

- Tabs per status with counts (one `groupBy`); pending first, oldest first,
  25 per page.
- Each card shows: product (linked), rating, title, body (plain text,
  escaped), display name, "Verifierat köp", submitted time, status, the
  order number (staff context), and a storefront link for approved reviews.
- Approve and reject buttons follow `canModerate` (PENDING → APPROVED or
  REJECTED; APPROVED ↔ REJECTED) and call `moderateReviewAndRevalidate`, so
  the product page is refreshed on demand (proven in E2E without waiting
  for the 60 s window).
- **No deletion in V1** (deviation from PROJECT.md §47 "delete where
  appropriate", as instructed). Rejecting removes a review from the
  storefront while its row keeps the one-review-per-order-line entitlement
  consumed; deleting it would let the customer's link review the line
  again.
- Review tokens never appear: the list does not select invitations at all.

### Store settings (`/admin/settings`)

- **Merchant-editable:** every StoreSettings column: store name,
  customer-service email, company name, organisationsnummer, flat shipping
  price, free-shipping threshold (empty = off), default carrier, VAT rate
  for new orders, low-stock threshold, homepage SEO title and description.
- **Not here:** Stripe and Resend keys, webhook and cron secrets,
  `EMAIL_FROM`, `AUTH_SECRET`, database URLs, storage tokens, `APP_URL`.
  They are environment variables, and the page says so.
- **Validation** (shared schema, authoritative on the server):
  - kronor typed as text and converted to öre by string arithmetic
    (`parseSekInput`);
  - shipping 0–1 000 kr; threshold 1 kr–100 000 kr or empty;
  - email format;
  - organisationsnummer normalized to `NNNNNN-NNNN`, with the Luhn check
    digit (a 12-digit form with century is accepted);
  - VAT restricted to the Swedish rates 25/12/6/0 %. It is a select, so a
    typo cannot charge the wrong VAT; old orders keep their snapshotted
    rate;
  - low-stock threshold 0–1 000; SEO lengths as in the catalog.

  The bounds catch misplaced digits and are easy to widen.

- **Service** (`updateStoreSettings`):
  - the OWNER is re-checked `FOR SHARE` and the row locked `FOR UPDATE`;
  - unchanged saves write nothing; otherwise one `UPDATE_STORE_SETTINGS`
    entry with old and new values per changed field;
  - a store without a row gets it created by the first save, which opens
    checkout;
  - two simultaneous first saves give a conflict message instead of a
    database error.
- **Revalidation** (`storeSettingsRevalidationTargets`):
  - footer details and the low-stock threshold are on every store page →
    `revalidatePath("/", "layout")`;
  - the SEO texts → the homepage;
  - shipping, threshold, carrier and VAT are read live by checkout, and the
    store name only by emails at send time → nothing.

  A failed refresh is logged and never fails the save.

### Navigation and UI

- Menu: Översikt, Beställningar, Recensioner, Produkter, Kategorier,
  Pokémon-set, Inställningar, Administratörer (OWNER).
- On phones and tablets the menu is one horizontally scrollable row that
  scrolls the current section into view. The page itself never scrolls
  sideways (E2E-checked on a Pixel 7). The Milestone 7 catalog pages are
  unchanged.
- Lists are tables on large screens and stacked cards on phones, like the
  product list. Status badges are monochrome; only real problems use the
  error color.
- New `error.tsx` for the admin panel (Swedish message, retry, the error
  digest) and a loading skeleton for the order and review pages. The
  skeleton is deliberately not panel-wide: a boundary around the Milestone 7
  product form shifted its hydration timing and made a catalog E2E test
  timing-sensitive under full-suite load. Every list has an empty state, and
  every form field a Swedish error.
- `AdminRowAction` became generic over the action-state type, so the
  attention button reuses it.

### Testing

- **Unit:**
  - settings schema: SEK ↔ öre, bounds, email, organisationsnummer and Luhn,
    VAT options, round trip;
  - order list parameters, search parsing and the fulfillment form mapping;
  - presenters: Swedish sentences, no echo of unknown metadata, malformed
    metadata;
  - Stripe links (test/live, malformed IDs) and settings revalidation
    targets;
  - the server actions with mocked session and services: role refusal
    before the service, redirect pass-through, error hiding, `reviewLinkKey`
    passed, email dispatch only for new obligations, revalidation calls, no
    delete export.
- **DB** (`tests/db/admin-orders.test.ts`,
  `tests/db/admin-reviews-settings.test.ts`, real PostgreSQL):
  - **Authorization:** list and detail for OWNER, ADMIN, inactive, unknown
    and malformed actors.
  - **List:** payment and fulfillment filters; search by number, Stripe ID,
    name and email; Stockholm date boundaries; sorting and paging; list
    privacy.
  - **Detail:** historic snapshots after product edits.
  - **Fulfillment:** NEW → PROCESSING → SHIPPED with one obligation, one
    invitation and one email; concurrent repeated SHIPPED saves; tracking
    correction without email; tracking untouched by other transitions;
    Swedish refusals.
  - **Refunds** visible without inventory changes.
  - **Needs attention:** counts for all three sources (one a real email
    failure), concurrent resolution, foreign and non-attention entries.
  - **Stock-blocking payment problems** (real checkout, mismatch recorded
    by the payment service): refused even under concurrent clicks, still
    open with a resolution entry present, kept reserved when Stripe still
    disagrees or is unreachable, released only when Stripe reports expired
    unpaid, finalized when Stripe reports a consistent payment, acknowledged
    only afterwards; closed orders and inactive administrators refused
    before Stripe is contacted. Disabling the blocking rule fails two of
    these tests (checked).
  - **Dashboard** counts and the sales definition.
  - **Reviews:** list, tokens absent, moderation and reversal, no delete
    decision, inactive moderators.
  - **Settings:** save in öre with audit; revalidation targets; ADMIN and
    inactive OWNER refused; invalid and tampered input; unchanged and
    concurrent identical saves; new shipping price, threshold and VAT
    applied by real checkouts (old orders unchanged); threshold off;
    low-stock threshold; first-save creation opening checkout.
- **E2E** (`admin-operations` project, after `reviews`):
  - login → dashboard (axe);
  - search and filter orders, open one: snapshots after a rename, personal
    data only on the detail, Stripe link (axe);
  - NEW → PROCESSING → SHIPPED with tracking; one shipping email with
    tracking and review link from the file outbox; tracking correction and
    a no-op save without email; COMPLETED; history;
  - refund display without a refund button or restocking;
  - a payment problem on the dashboard and the order, marked handled;
  - a stock-blocking payment problem (real checkout and signed webhook):
    no acknowledge button, recheck keeps the hold while Stripe disagrees,
    releases it once Stripe reports the checkout expired, then it can be
    acknowledged;
  - approving a pending review publishes it on the cached product page at
    once; rejecting removes it;
  - the OWNER changes contact email and shipping price → the footer of a
    cached page and the next checkout follow; then restores them;
  - ADMIN reads settings without a form and is refused administrators;
    signed-out redirects;
  - the phone menu without sideways page scroll.

  Two Milestone 6 assertions list the new menu.

### Deliberately not built

- Review deletion and manual email resends (see above).
- A global audit-log screen (PROJECT.md §48 "if appropriate"). Each order
  shows its history and the dashboard the latest order events; catalog and
  administrator entries stay in the table.
- A "restock returned item" button (§55). Restocking is the audited stock
  field on the product page, a deliberate staff decision (§35).
- A manual "release reservation" action: holds end only through Stripe's
  answer (see Needs attention).
- Revenue analytics beyond the 30-day summary.

### Dependencies

None added.

## Milestone 13 — SEO and discoverability (2026-10-02)

The page-by-page policy (indexing, fallbacks, canonicals, structured data,
sitemap, robots) is in [routes.md → SEO](routes.md#seo-milestone-13). This
section records the decisions behind it. There were **no schema changes**:
products, categories, sets and store settings already had every SEO field
needed, and the category/set `description` is the landing-page text.

### Audit: what already existed

Milestones 4–12 had already built most of the SEO base: `pageMetadata`,
listing canonical/noindex rules (`listingSeo`), shared fallbacks
(`catalog-defaults.ts`, also used by the admin previews), product
Product/Offer/AggregateRating/BreadcrumbList JSON-LD, visible breadcrumbs,
308 slug redirects with chain and loop protection, `X-Robots-Tag` on private
areas, a noindex archived-product page and real 404s. These were kept. The
gaps found and closed:

| Gap                                                                                                             | Fix                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| No sitemap, no robots.txt                                                                                       | `app/sitemap.ts`, `app/robots.ts`                                         |
| Previews and local builds were indexable copies of the store                                                    | deployment-level noindex and `Disallow: /` outside Vercel production      |
| Next.js _replaces_ the parent `openGraph`, so `og:locale`, `og:site_name` and `og:type` were lost on every page | `pageMetadata` states them on every page                                  |
| `robots: undefined` on indexable pages would also erase any parent robots value                                 | the key is omitted instead                                                |
| No social image without product photos                                                                          | `/brand/heavycards-share.png`                                             |
| Empty category/set pages were indexed (thin content)                                                            | `noindex, follow` while they have no listable product; not in the sitemap |
| Category/set descriptions were cut at 400 characters                                                            | the full landing text follows the products                                |
| No Organization/WebSite or collection structured data                                                           | homepage identity, `CollectionPage` on landing pages                      |
| JSON-LD claimed `NewCondition` for every product type                                                           | only for SEALED                                                           |
| Duplicate titles on paginated listings                                                                          | " – sida N"                                                               |
| Deprecated `next/image` `priority`                                                                              | `loading` and `fetchPriority` (see below)                                 |

### Deployment-level indexing

- `isIndexableDeployment(VERCEL_ENV)` is the single rule: only
  `VERCEL_ENV=production` may be indexed. It is evaluated when the
  deployment is built, like the rest of the environment validation; Vercel
  builds every preview and production deployment with its own `VERCEL_ENV`.
- Everywhere else, `next.config.ts` adds `X-Robots-Tag: noindex, nofollow`
  to every response and robots.txt disallows everything. Both layers are
  used: robots.txt stops well-behaved crawlers from fetching at all, and the
  header keeps out anything fetched anyway. Vercel also marks preview URLs
  itself, but that is not relied on.
- The per-page policy stays in `<meta name="robots">`, so it is visible and
  E2E-testable in every environment; the deployment layer is the header.
- Self-hosting outside Vercel is not covered by this rule (PROJECT.md names
  Vercel); it would need an explicit variable.
- Production robots.txt disallows only `/admin` and `/api/`. Token and
  session URLs (`/review/*`, `/kassa/*`) and `/sok` are deliberately left
  crawlable so their `noindex` can be read: a robots.txt block can still
  surface a leaked URL in results, without its content.

### Sitemap

- `getSitemapData` runs bounded queries in parallel: listable products
  (slug, `updatedAt`, primary image; at most 45 000), the categories and
  sets that have a listable product, two `groupBy`s for their products'
  latest change, and one aggregate. It never loads descriptions, reviews or
  reservations.
- Inclusion mirrors indexability exactly (`isListable`, the same
  `listableWhere` as the listing counts); DB tests assert it equals the
  storefront listing.
- ARCHIVED products are excluded: their page is noindex, and a sitemap
  lists only canonical, indexable URLs. The page itself stays, so old
  links, orders and reviews keep working.
- `revalidate = 3600`, plus `/sitemap.xml` in the catalog revalidation
  targets, so publishing, archiving and slug changes show at once.
- `lastmod` is meaningful: a product's own `updatedAt`; landing pages take
  the later of their own edit and their products' latest edit.

### Structured data

- Only data HeavyCards actually has is emitted. No brand (accessories may
  not be Pokémon, and there is no brand field), GTIN, shipping details or
  return policy (shipping times and return terms are not modelled, and the
  legal pages are still placeholders). Google may report these as optional
  missing fields; that is accepted rather than fabricated.
- COMING_SOON without preorder has no `Offer`, so Google may report the
  product as ineligible for rich results until it can be ordered. Any other
  availability value would be untrue.
- `sku` is included (a real identifier, not sensitive); `releaseDate` and a
  preorder's `availabilityStarts` match the date on the page.
- The serializer escapes `<`, `>`, `&`, U+2028 and U+2029; the output is
  still JSON that parses to the same values. Review text is plain data in
  both the HTML and the JSON-LD.
- Organization uses the brand name from config, and the legal name and
  contact email from store settings; changing those already revalidates
  every store page (Milestone 12). The logo is a 512×512 PNG rendering of
  the official mark, because search engines want a raster logo.

### Landing pages and internal linking

- Category/set text: the first paragraph leads the page (shortened at 400
  characters); the full text follows the products on page 1. Merchants
  write normal text in the existing "Beskrivning" field; no CMS was added.
- The set list that Milestone 4 had on `/pokemon-tcg` was removed by the
  owner's design change (commit 96d7072) and is not reintroduced. Set pages
  are reached from every product page (set link and related-products rail),
  from the set filter and from the sitemap. Category pages are linked from
  the homepage, `/pokemon-tcg`, search and every product breadcrumb.
- Breadcrumbs follow the canonical hierarchy Hem → Pokémon TCG → category →
  product; the visible trail and BreadcrumbList come from the same array.
- No general redirect table for arbitrary URLs was added (Milestone 7 left
  that open): only products, categories and sets have slugs that change,
  and those are covered.

### Images and Core Web Vitals

A targeted review only, not a rewrite.

- The product page's first image is the LCP element: `loading="eager"` and
  `fetchPriority="high"`, which the Next.js 16 docs recommend over
  `preload`. The deprecated `priority` prop is gone.
- Listing cards: the first four on page 1 load eagerly without high
  priority (several are LCP candidates depending on the viewport); the rest
  load lazily.
- Homepage product rows sit below the hero, whose heading is the LCP
  element, so they now load lazily. Before, they were preloaded and
  competed with critical resources.
- All product images keep their stored intrinsic dimensions and square
  frames (no CLS). Alt text is the admin text, otherwise the product name
  (", bild N" for later images). Gallery thumbnails stay `alt=""` inside
  labelled buttons.
- No new client components. JSON-LD is server-rendered; the homepage's
  script is placed last so it does not change the section order.
- Not done: a real Lighthouse/CrUX measurement, which needs the production
  deployment and real images (Milestone 15).

### Admin

- Product, category and set forms label the SEO fields "(valfri)" and say
  what a blank field falls back to; the automatic value is shown as the
  placeholder, so the merchant sees what will be used. The existing
  character guidance and search preview are kept.
- Store settings got the same treatment, plus a search preview for the
  homepage (an absolute title, without "| HeavyCards").
- No canonical, robots or structured-data controls are exposed: they are
  derived from status, slug and content.

### Known Next.js quirk

On the first, uncached render of a redirecting product, category or set
URL, Next.js 16.3.8 sends the identical `Location` header twice; cached
responses send it once. Status (308) and target are correct, and browsers
and crawlers follow it. The Milestone 7 architecture (redirect lookup only
on the not-found path) is kept; revisit when upgrading Next.js.

### Testing

- **Unit:** `pageMetadata` (Open Graph on every page, no `robots` key when
  indexable, share image vs product image, paged titles); product,
  category, set and homepage fallbacks and overrides; deployment indexing
  and robots.txt for production and non-production; the JSON-LD serializer
  against script break-out; Organization/WebSite; CollectionPage; product
  JSON-LD (identity, offer = visible price, availability mapping, preorder
  start, condition by type, no invented properties, no rating without
  approved reviews, rounding, review cap, hostile review text); the sitemap
  builder; landing copy; `listingSeo` with tracking parameters and empty
  landing pages; eager and lazy card images; revalidation targets.
- **DB** (`tests/db/seo.test.ts`, seeded catalog): sitemap products equal
  the listable set and the storefront listing (no DRAFT, ARCHIVED or future
  publications); primary images; only categories and sets with listable
  products; landing `lastmod`; the bound; listable counts; a renamed
  product leaves the sitemap at its old URL, which 308s to a listed URL
  with no chain; archiving removes it.
- **E2E** (`e2e/seo.spec.ts` on desktop and mobile, plus one test in
  `admin-catalog`): robots.txt and `X-Robots-Tag` of a non-production
  build; sitemap contents and exclusions; homepage, product, category,
  filtered, empty-set, search and 404 metadata and canonicals (including
  tracking parameters); product JSON-LD against the visible price, stock
  label and breadcrumbs; no rating without approved reviews; no offer for
  coming soon; no JSON-LD on archived pages; the seeded 308 redirect; main
  image loading. The admin test sets an SEO title and description, sees
  them on the cached product page, and sees the sitemap add the product on
  publish and drop it on archive.
- Two existing E2E assertions changed: the smoke test now expects
  `X-Robots-Tag: noindex, nofollow` on `/` (E2E runs a non-production
  build), and one category test selects "Beskrivning (valfri)" exactly,
  since "Metabeskrivning (valfri)" also matches it.
- Structured data is checked against the expected schema.org shapes in
  these tests. Google's Rich Results Test and Search Console have **not**
  been run: they need the deployed production URL.

### Dependencies

None added. The share image and raster logo were rendered once from the
official SVG with the already-installed `sharp` (shape unchanged; white on
black and black on white) and are committed as static assets.

### Manual SEO work for launch (Milestone 15)

- Set `APP_URL` to the final https domain, and redirect the `*.vercel.app`
  production alias (and `www`, if it is not the canonical host) to it in
  Vercel.
- Verify the domain in Google Search Console with a DNS TXT record (no
  token in source), submit `https://<domain>/sitemap.xml`, and inspect the
  homepage, a product, a category and a set with URL Inspection.
- Run the Rich Results Test on a product with approved reviews and on the
  homepage.
- Check that `https://<domain>/robots.txt` shows `Allow: /` on production
  and that a preview URL shows `Disallow: /`.
- Replace the seed catalog and example image with real products and photos,
  then run Lighthouse/PageSpeed on mobile for the homepage, a category and
  a product.
- Write Swedish category and set descriptions (a few paragraphs) for the
  important landing pages.
- When the information and legal pages have reviewed content, set
  `indexable: true` for them in `src/lib/config/info-pages.ts`.
- Optional: a custom homepage SEO title and description in Inställningar.
