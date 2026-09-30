import { z } from "zod";

/*
 * Listing URL parameters (Swedish, shareable, server-validated). Invalid or
 * unknown values are dropped rather than rejected, so a mangled link still
 * renders a sensible page instead of an error.
 */

export const sortOptions = {
  relevans: "relevance",
  nyast: "newest",
  "pris-stigande": "price-asc",
  "pris-fallande": "price-desc",
} as const;

export type SortParam = keyof typeof sortOptions;
export type SortKey = (typeof sortOptions)[SortParam] | "release";

export const sortLabels: Readonly<Record<SortParam, string>> = {
  relevans: "Mest relevant",
  nyast: "Nyast",
  "pris-stigande": "Pris: lägst först",
  "pris-fallande": "Pris: högst först",
};

export const DEFAULT_SORT: SortParam = "nyast";

/** Sort choices on catalog listings; search adds relevance first. */
export const LISTING_SORTS: readonly SortParam[] = [
  "nyast",
  "pris-stigande",
  "pris-fallande",
];
export const SEARCH_SORTS: readonly SortParam[] = [
  "relevans",
  ...LISTING_SORTS,
];
export const IN_STOCK_PARAM = "i-lager";
export const MAX_PAGE = 500;
export const MAX_QUERY_LENGTH = 100;

const slug = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Takes the first value when a parameter is repeated (?a=1&a=2). */
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(first, schema.optional().catch(undefined));

const listingParamsSchema = z.object({
  sortering: optional(z.enum(Object.keys(sortOptions) as [SortParam])),
  kategori: optional(slug),
  set: optional(slug),
  tillganglighet: optional(z.literal(IN_STOCK_PARAM)),
  sida: optional(z.coerce.number().int().min(1).max(MAX_PAGE)),
  q: optional(z.string()),
});

export type ListingParams = Readonly<{
  sort: SortParam | undefined;
  categorySlug: string | undefined;
  setSlug: string | undefined;
  inStockOnly: boolean;
  page: number;
  query: string;
}>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseListingParams(raw: RawSearchParams): ListingParams {
  const parsed = listingParamsSchema.parse(raw);
  return {
    sort: parsed.sortering,
    categorySlug: parsed.kategori,
    setSlug: parsed.set,
    inStockOnly: parsed.tillganglighet === IN_STOCK_PARAM,
    page: parsed.sida ?? 1,
    query: normalizeQuery(parsed.q ?? ""),
  };
}

/** Collapses whitespace and bounds the length of a search query. */
export function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * Search terms: lowercased words of at least two characters, at most five.
 * Accented e-variants are folded ("Pokémon" ≈ "pokemon"); å, ä and ö are
 * kept, since they are distinct Swedish letters.
 */
export function searchTerms(query: string): string[] {
  return foldForSearch(query)
    .split(" ")
    .filter((term) => term.length >= 2)
    .slice(0, 5);
}

export function foldForSearch(value: string): string {
  return value.toLowerCase().replace(/[éèêë]/g, "e");
}

/** Whether the listing differs from its canonical, unfiltered form. */
export function hasFilterOrSort(
  params: ListingParams,
  defaultSort: SortParam = DEFAULT_SORT,
): boolean {
  return Boolean(
    params.categorySlug ||
    params.setSlug ||
    params.inStockOnly ||
    (params.sort && params.sort !== defaultSort),
  );
}

/**
 * Builds a listing URL keeping only meaningful parameters. Used for
 * pagination links, filter removal and canonical URLs.
 */
export function listingHref(
  path: string,
  params: Partial<ListingParams>,
  defaultSort: SortParam = DEFAULT_SORT,
): string {
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.categorySlug) search.set("kategori", params.categorySlug);
  if (params.setSlug) search.set("set", params.setSlug);
  if (params.inStockOnly) search.set("tillganglighet", IN_STOCK_PARAM);
  if (params.sort && params.sort !== defaultSort) {
    search.set("sortering", params.sort);
  }
  if (params.page && params.page > 1) search.set("sida", String(params.page));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export type ListingSeo = { canonical: string; index: boolean };

/**
 * Duplicate-content control for listing variants (PROJECT.md §65):
 * - unfiltered pages (and their pagination) are indexable and self-canonical;
 * - filtered or re-sorted variants are `noindex, follow` and point their
 *   canonical at the unfiltered listing, so crawlers follow the products
 *   without indexing thousands of combinations.
 */
export function listingSeo(path: string, params: ListingParams): ListingSeo {
  if (hasFilterOrSort(params)) {
    return { canonical: path, index: false };
  }
  return { canonical: listingHref(path, { page: params.page }), index: true };
}
