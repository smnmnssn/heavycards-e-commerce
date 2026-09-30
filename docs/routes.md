# Route design

Public URLs are Swedish, lowercase, slug-based and free of database IDs
(PROJECT.md §60). This is the planned route map. Routes are added in the
milestone noted, and any change here must be decided before pages are built,
since published URLs need permanent redirects once live.

## Storefront

All storefront routes below exist as of Milestone 4 (except `/review/[token]`).

| Route                        | Page                                            | Rendering | Indexable                |
| ---------------------------- | ----------------------------------------------- | --------- | ------------------------ |
| `/`                          | Homepage with database-backed sections          | ISR 60 s  | yes                      |
| `/pokemon-tcg`               | Landing page: categories, sets, full listing    | dynamic   | yes (unfiltered)         |
| `/pokemon-tcg/[productSlug]` | Product page                                    | ISR 60 s  | yes; archived: `noindex` |
| `/kategori/[slug]`           | Category landing page                           | dynamic   | yes (unfiltered)         |
| `/set/[slug]`                | Pokémon set landing page                        | dynamic   | yes (unfiltered)         |
| `/nyheter`                   | ACTIVE products published in the last 60 days   | dynamic   | yes                      |
| `/kommande`                  | COMING_SOON, preorders and future release dates | dynamic   | yes                      |
| `/sok?q=…`                   | Search results                                  | dynamic   | no                       |
| `/review/[token]`            | Secure review page (Milestone 11)               | —         | no                       |

Unknown product, category and set slugs, draft or unpublished products, and
page numbers beyond the last page return HTTP 404 with the store's 404 page.

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

### SEO behavior per page type

| Page type      | Title / description                                                                       | Canonical                     | Robots                                   |
| -------------- | ----------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Homepage       | `StoreSettings.defaultSeoTitle/Description`, else generated                               | `/`                           | index                                    |
| Product        | `seoTitle` → name; `seoDescription` → short description → description excerpt → generated | own URL                       | index; archived `noindex`                |
| Category / set | `seoTitle` → "{name} – Pokémon TCG(-set)"; `seoDescription` → description → generated     | unfiltered URL                | index; filtered/sorted `noindex, follow` |
| Listings       | fixed Swedish title and description                                                       | self (with `?sida=` when > 1) | index; filtered/sorted `noindex, follow` |
| Search         | "Sökresultat för ”q”"                                                                     | `/sok`                        | `noindex, follow`                        |

- Titles use the "%s | HeavyCards" template.
- Descriptions are cut to 160 characters at a word boundary.
- Every product, category and set page has visible breadcrumbs plus
  BreadcrumbList JSON-LD.
- Product pages also have basic Product/Offer JSON-LD, with AggregateRating
  and reviews from approved reviews only.
- The sitemap, redirects and full structured data are completed in
  Milestone 13.

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
reviewed, before launch (PROJECT.md §71). Remove `noindex` when real content is
published.

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

| Route                 | Purpose                                             | Milestone |
| --------------------- | --------------------------------------------------- | --------- |
| `/admin/**`           | Admin application (never indexable)                 | 6+        |
| `/api/health`         | Health check                                        | 1–2       |
| `/api/cart`           | POST: current data for cart product IDs (read-only) | 5         |
| `/api/stripe/webhook` | Stripe webhook                                      | 9         |

`/admin/**` and `/api/**` send `X-Robots-Tag: noindex, nofollow` (next.config.ts).

## Development only

| Route           | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `/designsystem` | Visual reference for the design primitives. Returns 404 outside `next dev`. |

## Navigation

The header carries only: **Nyheter**, **Pokémon TCG**, **Kommande** and
**Om oss** (PROJECT.md §9), plus search and the cart. Categories and sets are
reached from the homepage, listings and product pages, not the top navigation.
Navigation is defined once in `src/lib/config/navigation.ts`.
