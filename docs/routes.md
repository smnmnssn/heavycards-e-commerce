# Route design

Public URLs are Swedish, lowercase, slug-based and free of database IDs
(PROJECT.md §60). This is the planned route map. Routes are added in the
milestone noted, and any change here must be decided before pages are built,
since published URLs need permanent redirects once live.

## Storefront

| Route                        | Page                                    | Milestone           | Indexable      |
| ---------------------------- | --------------------------------------- | ------------------- | -------------- |
| `/`                          | Homepage                                | 3 (shell), 4 (data) | yes            |
| `/nyheter`                   | New arrivals (recently published)       | 4                   | yes            |
| `/pokemon-tcg`               | All Pokémon TCG products (main listing) | 4                   | yes            |
| `/pokemon-tcg/[productSlug]` | Product page                            | 4                   | yes            |
| `/kommande`                  | Upcoming releases and preorders         | 4                   | yes            |
| `/kategori/[slug]`           | Category landing page                   | 4                   | yes            |
| `/set/[slug]`                | Pokémon set landing page                | 4                   | yes            |
| `/sok?q=…`                   | Search results                          | 4                   | no (`noindex`) |
| `/review/[token]`            | Secure review page                      | 11                  | no             |

**Filtered and sorted variants.** Query parameters on listing pages (e.g.
`?sortering=pris-stigande`) render with a canonical URL pointing at the
unfiltered page, so search engines do not index thousands of variants
(PROJECT.md §65). Details are decided in Milestone 4.

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

| Route                 | Purpose                             | Milestone |
| --------------------- | ----------------------------------- | --------- |
| `/admin/**`           | Admin application (never indexable) | 6+        |
| `/api/health`         | Health check                        | 1–2       |
| `/api/stripe/webhook` | Stripe webhook                      | 9         |

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
