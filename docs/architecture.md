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
