# Route design

Public URLs are Swedish, lowercase, slug-based and free of database IDs
(PROJECT.md §60). This is the planned route map. Routes are added in the
milestone noted, and any change here must be decided before pages are built,
since published URLs need permanent redirects once live.

## Storefront

All storefront routes below exist as of Milestone 4; `/review/[token]` since Milestone 11.

| Route                        | Page                                                                                                                                                                  | Rendering | Indexable                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------- |
| `/`                          | Homepage with database-backed sections                                                                                                                                | ISR 60 s  | yes                               |
| `/pokemon-tcg`               | Landing page: categories, full listing (set filter)                                                                                                                   | dynamic   | yes (unfiltered)                  |
| `/pokemon-tcg/[productSlug]` | Product page                                                                                                                                                          | ISR 60 s  | yes; archived: `noindex`          |
| `/kategori/[slug]`           | Category landing page                                                                                                                                                 | dynamic   | yes (unfiltered, if any products) |
| `/set/[slug]`                | Pokémon set landing page                                                                                                                                              | dynamic   | yes (unfiltered, if any products) |
| `/nyheter`                   | ACTIVE products published in the last 60 days                                                                                                                         | dynamic   | yes                               |
| `/kommande`                  | COMING_SOON, preorders and future release dates                                                                                                                       | dynamic   | yes                               |
| `/sok?q=…`                   | Search results                                                                                                                                                        | dynamic   | no                                |
| `/review/[token]`            | Secure review page from the shipping email: the order's purchased products with one review form each; one generic page for every unusable link; rate-limited          | dynamic   | no                                |
| `/kassa/bekraftelse`         | Stripe success URL: payment state from the database only (processing, paid with products and total, expired, failed); clears this browser's purchased items once paid | dynamic   | no                                |
| `/kassa/avbruten`            | Stripe cancel URL: cart kept, "Visa kundvagnen"                                                                                                                       | ISR 60 s  | no                                |

Unknown product, category and set slugs, draft or unpublished products, and
page numbers beyond the last page return HTTP 404 with the store's 404 page.
A product, category or set URL that changed (renamed slug, or a deleted
category or set) answers with a permanent redirect (HTTP 308) to its new
location instead (Milestone 7; see database.md → Redirects).

### Listing parameters

Validated server-side (`src/server/domain/catalog-params.ts`). Invalid values
are ignored rather than rejected.

| Parameter        | Values                                                                           | Where                         |
| ---------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| `kategori`       | category slug                                                                    | `/pokemon-tcg`, `/set/*`      |
| `set`            | set slug                                                                         | `/pokemon-tcg`, `/kategori/*` |
| `tillganglighet` | `i-lager` (purchasable now, including preorders)                                 | listings, search              |
| `sortering`      | `nyast` (default), `pris-stigande`, `pris-fallande`; `relevans` (search default) | listings, search              |
| `sida`           | 1–500                                                                            | all listings                  |
| `q`              | search text, max 100 characters                                                  | `/sok`                        |

### SEO (Milestone 13)

#### Indexing per page type

| Page                                       | Indexed                                                     | Canonical                       | Sitemap                        |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------- | ------------------------------ |
| `/`                                        | yes                                                         | `/`                             | yes                            |
| `/pokemon-tcg`, `/nyheter`, `/kommande`    | yes; filtered or re-sorted variants `noindex, follow`       | unfiltered URL (+ `?sida=` > 1) | unfiltered page 1              |
| `/kategori/*`, `/set/*`                    | yes while it has a listable product, else `noindex, follow` | unfiltered URL (+ `?sida=` > 1) | when it has a listable product |
| `/pokemon-tcg/[slug]` ACTIVE / COMING_SOON | yes                                                         | own URL (current slug)          | yes                            |
| `/pokemon-tcg/[slug]` ARCHIVED             | `noindex, follow` (page kept for old links and orders)      | own URL                         | no                             |
| `/pokemon-tcg/[slug]` DRAFT / unpublished  | — (HTTP 404)                                                | —                               | no                             |
| `/sok`                                     | `noindex, follow`                                           | `/sok`                          | no                             |
| Information pages                          | `noindex, follow` until `indexable: true` in their config   | own URL                         | once indexable                 |
| `/kassa/**`, `/review/**`                  | `noindex, nofollow` (meta and `X-Robots-Tag`)               | —                               | no                             |
| `/admin/**`, `/api/**`                     | `noindex, nofollow` (`X-Robots-Tag`), disallowed in robots  | —                               | no                             |
| 404 and error pages                        | `noindex` (real 404/500 status)                             | —                               | no                             |

"Listable" means ACTIVE or COMING_SOON with `publishedAt` set and not in the
future (`isListable`). Sold-out products stay indexed: the page is still the
best answer for the product, and its offer says `OutOfStock`. `/nyheter` and
`/kommande` stay indexable when empty, because they are permanent navigation
pages; empty categories and sets are not.

#### Metadata fallbacks

Stored fields always win; blank (or whitespace-only) fields fall back. The
rules live in `src/lib/seo/catalog-defaults.ts` and are shared with the admin
search previews.

| Page     | Title                                                                          | Meta description                                                                                             |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Homepage | `StoreSettings.defaultSeoTitle` → "HeavyCards – Pokémon TCG i Sverige" (as-is) | `defaultSeoDescription` → fixed Swedish description                                                          |
| Product  | `seoTitle` → product name                                                      | `seoDescription` → short description → description excerpt → "Köp {namn} hos HeavyCards, från setet {set} …" |
| Category | `seoTitle` → "{namn} – Pokémon TCG"                                            | `seoDescription` → description → generated sentence                                                          |
| Set      | `seoTitle` → "{namn} – Pokémon TCG-set"                                        | `seoDescription` → description → generated sentence                                                          |
| Listings | fixed Swedish titles                                                           | fixed Swedish descriptions                                                                                   |

- Titles get the "%s | HeavyCards" template (except the homepage); listing
  pages after the first add " – sida N".
- Descriptions are cut to 160 characters at a word boundary.
- Every page states Open Graph `type`, `site_name`, `locale` (`sv_SE`), title,
  description, URL and image: the product's primary image on product pages,
  otherwise `/brand/heavycards-share.png` (1200×630). X/Twitter reads these;
  only `twitter:card` is set separately. No third-party scripts.
- `<html lang="sv">`, prices in SEK, no alternate-language URLs.
- Category and set descriptions are the landing-page text: the first
  paragraph leads the page, the full text follows the products (page 1).

#### Canonicals and URL parameters

- Canonicals are absolute (`metadataBase` = `APP_URL`) and always use the
  current slug.
- `sortering`, `kategori`, `set` and `tillganglighet` create filtered
  variants: `noindex, follow`, canonical to the unfiltered listing. Customers
  keep every filter; crawlers follow the products but index only the base
  page. Filters are GET forms, not links, so crawlers rarely find variants.
- `sida` is part of the canonical (page 2+ lists other products) and of the
  title. Out-of-range pages are real 404s.
- The default sort (`?sortering=nyast`), `?sida=1` and every unknown
  parameter (`utm_*`, `gclid`, `fbclid`, …) are dropped from the canonical.
- `q` only means something on `/sok`, which is never indexed.

#### Structured data (JSON-LD)

| Page                          | Types                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Homepage                      | `Organization` (name, URL, raster logo; legal name and email once set in settings), `WebSite`                |
| Product (not archived)        | `Product` with `Offer`; `AggregateRating` and up to 5 `Review`s from APPROVED reviews only; `BreadcrumbList` |
| Category, set, `/pokemon-tcg` | `BreadcrumbList`; `CollectionPage` with an `ItemList` of the listed products (indexable variants only)       |
| `/nyheter`, `/kommande`       | `BreadcrumbList`                                                                                             |

- The offer uses the displayed price and the purchase panel's availability
  (InStock, LimitedAvailability, OutOfStock, PreOrder with
  `availabilityStarts` = the release date). COMING_SOON products without
  preorder have no offer: there is nothing to buy yet.
- `itemCondition: NewCondition` only for SEALED products.
- Not emitted, because HeavyCards does not record them: brand, manufacturer,
  GTIN/MPN, shipping details, return policy. No `SearchAction` (Google
  retired the sitelinks search box).
- Serialization escapes `<`, `>`, `&`, U+2028 and U+2029, so no content can
  close the script element.

#### Sitemap (`/sitemap.xml`)

Generated from the database (`getSitemapData`, `buildSitemap`): the homepage,
`/pokemon-tcg`, `/nyheter`, `/kommande`, categories and sets with a listable
product, listable products (with their primary image) and published
information pages. `lastmod` is a product's `updatedAt`, a landing page's
latest own or product change, and the latest product change for listings.
Cached for an hour and refreshed at once by every admin catalog change. At
most 45 000 product URLs (one sitemap file holds 50 000); a larger catalog
would split it with `generateSitemaps`.

#### robots.txt and non-production deployments

- **Vercel production** (`VERCEL_ENV=production`): `Allow: /`,
  `Disallow: /admin` and `/api/`, plus the sitemap URL. `/kassa`, `/review`
  and `/sok` stay crawlable on purpose, so crawlers can see their `noindex`
  (a robots.txt block could still list a leaked token URL without content).
- **Every other build** (Vercel previews, local, CI, E2E): `Disallow: /`, and
  every response carries `X-Robots-Tag: noindex, nofollow`. Decided when the
  deployment is built (`src/lib/seo/indexing.ts`).

#### Slug changes

Renamed products (once published), categories and sets answer their old URL
with HTTP 308 to the new one; chains are flattened and loops prevented
(Milestone 7, see database.md → Redirects). Deleted categories and sets
redirect to `/pokemon-tcg`. Redirect sources are never in the sitemap.

### Product states on the storefront

| State (`getAvailability`) | When                                                      | Label                      | Purchasable |
| ------------------------- | --------------------------------------------------------- | -------------------------- | ----------- |
| in stock                  | ACTIVE, available > low-stock threshold                   | I lager                    | yes         |
| low stock                 | ACTIVE, 0 < available ≤ `StoreSettings.lowStockThreshold` | Få kvar i lager            | yes         |
| sold out                  | ACTIVE, available = 0                                     | Slutsåld                   | no          |
| preorder                  | `isPreorder` (ACTIVE or COMING_SOON), available > 0       | Förbeställ                 | yes         |
| preorder sold out         | `isPreorder`, available = 0                               | Förbeställningar slutsålda | no          |
| coming soon               | COMING_SOON without preorder                              | Kommer snart               | no          |
| discontinued              | ARCHIVED (page only, never listed)                        | Säljs inte längre          | no          |

- `available = stockOnHand − active, unexpired reservations`.
- Exact quantities are never shown.
- For preorders, `stockOnHand` is the preorder allocation.

## Information and legal

These routes exist from Milestone 3 as placeholder pages marked `noindex`. The
store owner must write and review the content, and legal wording must be
reviewed, before launch (PROJECT.md §71). When a page has its real content,
set `indexable: true` for it in `src/lib/config/info-pages.ts`: that removes
`noindex` and adds it to the sitemap.

| Route                  | Page                |
| ---------------------- | ------------------- |
| `/om-oss`              | Om oss              |
| `/kontakt`             | Kontakt             |
| `/leveransinformation` | Leveransinformation |
| `/retur-och-angerratt` | Retur & ångerrätt   |
| `/kopvillkor`          | Köpvillkor          |
| `/integritetspolicy`   | Integritetspolicy   |
| `/cookiepolicy`        | Cookiepolicy        |

Swedish characters are transliterated in slugs (å/ä → a, ö → o).

## Admin and API

| Route                             | Purpose                                                                                                                                                                                                             | Milestone |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/admin/login`                    | Sign-in (public)                                                                                                                                                                                                    | 6         |
| `/admin/forgot-password`          | Request a password-reset link (public)                                                                                                                                                                              | 6         |
| `/admin/reset-password`           | Set a new password with `?token=` (public)                                                                                                                                                                          | 6         |
| `/admin/invite`                   | Accept an invitation with `?token=` (public)                                                                                                                                                                        | 6         |
| `/admin`                          | Overview: orders to start/ship, needs-attention problems, pending reviews, low stock, queued email, 30-day sales, latest orders and order events (OWNER, ADMIN)                                                     | 6, 12     |
| `/admin/orders`                   | Order list: search (HC-number, name, email, Stripe ID), payment/fulfillment/attention/date filters, sorting, 50 per page; shows the customer's name only                                                            | 12        |
| `/admin/orders/[id]`              | Order detail: snapshots, totals, customer and address, Stripe IDs and Dashboard link, refunds, fulfillment and tracking, emails, review link dates, attention items (Stripe re-check for pending payments), history | 12        |
| `/admin/reviews`                  | Review moderation: pending first (oldest first), approve/reject, approved ↔ rejected; no deletion                                                                                                                   | 12        |
| `/admin/settings`                 | Store settings: OWNER edits, ADMIN reads; no infrastructure configuration                                                                                                                                           | 12        |
| `/admin/users`                    | Administrator management (OWNER only)                                                                                                                                                                               | 6         |
| `/admin/products`                 | Product list: search, filters, low stock (OWNER, ADMIN)                                                                                                                                                             | 7         |
| `/admin/products/new`             | Create a product                                                                                                                                                                                                    | 7         |
| `/admin/products/[id]`            | Edit a product: content, price, stock, status, images, SEO; delete only unused drafts                                                                                                                               | 7         |
| `/admin/categories`               | Category list; `/new` and `/[id]` create and edit (delete only when unused)                                                                                                                                         | 7         |
| `/admin/sets`                     | Pokémon-set list; `/new` and `/[id]` create and edit (delete only when unused)                                                                                                                                      | 7         |
| `/api/auth/*`                     | Better Auth: sign-in, sign-out, get-session, password reset only; every other path is 404                                                                                                                           | 6         |
| `/api/health`                     | Health check                                                                                                                                                                                                        | 1–2       |
| `/api/cart`                       | POST: current data for cart product IDs (read-only); optional `attemptId` excludes that checkout attempt's own hold                                                                                                 | 5, 8      |
| `/api/checkout`                   | POST: start Stripe Checkout (same origin, rate-limited, validates and reserves; returns the Stripe URL)                                                                                                             | 8         |
| `/api/admin/products/[id]/images` | POST: upload one product image (same origin, signed-in OWNER/ADMIN, ≤ 4 MB)                                                                                                                                         | 7         |
| `/api/media/*`                    | GET: images stored by the local storage provider (development/E2E only; 404 otherwise)                                                                                                                              | 7         |
| `/api/stripe/webhook`             | POST: Stripe events, signature-verified on the raw body; finalizes payments, releases expired/failed checkouts, synchronizes refunds                                                                                | 9         |
| `/api/cron/reconcile-checkouts`   | GET: reconcile unresolved Stripe checkouts, then send pending and retryable order emails as a separate step (Vercel Cron, `Authorization: Bearer CRON_SECRET`; 401 otherwise)                                       | 9, 10     |

`/admin/**`, `/kassa/**` and `/api/**` send `X-Robots-Tag: noindex, nofollow`
(next.config.ts); `/kassa/**` also sends `Referrer-Policy: no-referrer`
because the success URL carries the Stripe session ID. The `/kassa` pages are
not linked from navigation or the sitemap.
`/admin/**` also sends `Referrer-Policy: no-referrer`, because invitation and
reset links carry tokens in the query string. `/review/**` sends both
headers too (the path is a review token), and is never in the sitemap. `src/proxy.ts` redirects
requests without a session cookie to `/admin/login`; it is a convenience only,
and every admin page and action authorizes itself on the server.

## Development only

| Route           | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `/designsystem` | Visual reference for the design primitives. Returns 404 outside `next dev`. |

## Navigation

The header carries only: **Nyheter**, **Pokémon TCG**, **Kommande** and
**Om oss** (PROJECT.md §9), plus search and the cart. Categories and sets are
reached from the homepage, listings and product pages, not the top navigation.
Navigation is defined once in `src/lib/config/navigation.ts`.
