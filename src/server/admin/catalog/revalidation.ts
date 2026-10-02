import { productPath } from "@/lib/catalog-paths";

/*
 * Storefront cache refresh after catalog mutations (PROJECT.md §59, §92).
 *
 * Product pages and the homepage are ISR pages (revalidate = 60). Without
 * this, an admin edit would appear within 60 seconds; with it, the affected
 * pages are re-rendered on their next visit. Information pages are not
 * touched (they show no catalog data), so their caching is unaffected.
 *
 * Product pages are invalidated by route pattern, not only by URL, because
 * every product page shows other products (related rail, category and set
 * names in links). Listing, category, set and search pages render per
 * request already; they are included so this stays correct if one of them
 * becomes cached later.
 *
 * Patterns include the `(store)` route group: Next derives a page's implicit
 * cache tags from its route file path.
 */

export type RevalidationTarget = { path: string; type?: "page" | "layout" };

const LISTING_TARGETS: readonly RevalidationTarget[] = [
  { path: "/" },
  { path: "/pokemon-tcg" },
  { path: "/nyheter" },
  { path: "/kommande" },
  { path: "/sok" },
  { path: "/(store)/kategori/[slug]", type: "page" },
  { path: "/(store)/set/[slug]", type: "page" },
  { path: "/(store)/pokemon-tcg/[productSlug]", type: "page" },
  // Products, categories and sets enter or leave the sitemap with these
  // changes (publish, archive, slug change, a landing page gaining or losing
  // its last product).
  { path: "/sitemap.xml" },
];

/**
 * Pages to refresh after any catalog change. `productSlugs` are the old and
 * new slugs of a changed product, refreshed by URL as well, so a renamed
 * product's old URL immediately serves its redirect.
 */
export function catalogRevalidationTargets(
  productSlugs: readonly string[] = [],
): RevalidationTarget[] {
  return [
    ...LISTING_TARGETS,
    ...productSlugs.map((slug) => ({ path: productPath(slug) })),
  ];
}
