/**
 * Public catalog URLs (docs/routes.md). One definition shared by the
 * storefront, admin links, redirects and cache revalidation.
 */

export const productPath = (slug: string) => `/pokemon-tcg/${slug}`;
export const categoryPath = (slug: string) => `/kategori/${slug}`;
export const setPath = (slug: string) => `/set/${slug}`;

/** Where URLs of deleted categories and sets are redirected. */
export const CATALOG_ROOT_PATH = "/pokemon-tcg";
