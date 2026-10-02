import type { MetadataRoute } from "next";

import { categoryPath, productPath, setPath } from "@/lib/catalog-paths";
import { infoPages, type InfoPageSlug } from "@/lib/config/info-pages";
import { absoluteUrl } from "@/lib/seo/json-ld";
import type { SitemapData } from "@/server/data/catalog-queries";

/*
 * Sitemap policy (docs/routes.md → Sitemap): only canonical URLs that are
 * indexable. Listed:
 * - the homepage and the catalog listings (/pokemon-tcg, /nyheter, /kommande);
 * - listable products (ACTIVE or COMING_SOON, published);
 * - categories and sets with at least one listable product;
 * - information pages once they are published (`indexable` in their config).
 * Never listed: drafts, archived products (their pages are noindex), empty
 * landing pages, filtered/sorted/paginated variants, search, checkout,
 * review links, admin and API routes.
 */

export const SITEMAP_LISTING_PATHS = [
  "/",
  "/pokemon-tcg",
  "/nyheter",
  "/kommande",
] as const;

export function buildSitemap(
  siteUrl: string,
  data: SitemapData,
): MetadataRoute.Sitemap {
  const url = (path: string) => absoluteUrl(siteUrl, path);
  const catalogModified = data.catalogUpdatedAt
    ? { lastModified: data.catalogUpdatedAt }
    : {};

  const infoPaths = (Object.keys(infoPages) as InfoPageSlug[])
    .filter((slug) => infoPages[slug].indexable)
    .map((slug) => `/${slug}`);

  return [
    ...SITEMAP_LISTING_PATHS.map((path) => ({
      url: url(path),
      ...catalogModified,
    })),
    ...data.categories.map((category) => ({
      url: url(categoryPath(category.slug)),
      lastModified: category.lastModified,
    })),
    ...data.sets.map((set) => ({
      url: url(setPath(set.slug)),
      lastModified: set.lastModified,
    })),
    ...data.products.map((product) => ({
      url: url(productPath(product.slug)),
      lastModified: product.updatedAt,
      ...(product.imageUrl ? { images: [url(product.imageUrl)] } : {}),
    })),
    ...infoPaths.map((path) => ({ url: url(path) })),
  ];
}
