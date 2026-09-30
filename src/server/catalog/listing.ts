import "server-only";

import type { ProductCardData } from "@/components/store/product-card";
import { stockholmToday } from "@/lib/dates";
import { db } from "@/lib/db/client";
import {
  listCategories,
  listProducts,
  listSets,
  type ListingScope,
  type SetLink,
  type TaxonomyLink,
} from "@/server/data/catalog-queries";
import { getPublicStoreInfo } from "@/server/data/store-settings";
import {
  sortOptions,
  type ListingParams,
  type SortKey,
} from "@/server/domain/catalog-params";

import { toProductCardData, type PresentationContext } from "./presenters";

/** Bounded page size: listings never fetch the whole catalog. */
export const LISTING_PAGE_SIZE = 24;

export async function presentationContext(
  now: Date,
): Promise<PresentationContext> {
  const { lowStockThreshold } = await getPublicStoreInfo();
  return { now, today: stockholmToday(now), lowStockThreshold };
}

export type LoadedListing = {
  cards: ProductCardData[];
  total: number;
  page: number;
  pageCount: number;
};

/** Loads one page of a listing and maps it to product card props. */
export async function loadListing({
  params,
  scope,
  categorySlug,
  setSlug,
  searchTerms,
  defaultSort,
  now,
}: {
  params: ListingParams;
  scope?: ListingScope;
  categorySlug?: string;
  setSlug?: string;
  searchTerms?: readonly string[];
  defaultSort: SortKey;
  now: Date;
}): Promise<LoadedListing> {
  const [result, context] = await Promise.all([
    listProducts(db, {
      scope,
      categorySlug: categorySlug ?? params.categorySlug,
      setSlug: setSlug ?? params.setSlug,
      inStockOnly: params.inStockOnly,
      searchTerms,
      sort: params.sort ? sortOptions[params.sort] : defaultSort,
      page: params.page,
      pageSize: LISTING_PAGE_SIZE,
      now,
    }),
    presentationContext(now),
  ]);

  return {
    cards: result.items.map((item) => toProductCardData(item, context)),
    total: result.total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(result.total / LISTING_PAGE_SIZE)),
  };
}

export type ListingFilterOptions = {
  categories: TaxonomyLink[];
  sets: SetLink[];
};

/** Categories and sets that have listable products, for filter menus. */
export async function loadFilterOptions(
  now: Date,
): Promise<ListingFilterOptions> {
  const [categories, sets] = await Promise.all([
    listCategories(db, now),
    listSets(db, now),
  ]);
  return {
    categories: categories.filter((category) => category.productCount > 0),
    sets: sets.filter((set) => set.productCount > 0),
  };
}

/**
 * Drops filter values that do not match a known category or set, so a
 * mangled or outdated link degrades to the unfiltered listing.
 */
export function sanitizeFilters(
  params: ListingParams,
  options: ListingFilterOptions,
): ListingParams {
  const knownCategory = options.categories.some(
    (category) => category.slug === params.categorySlug,
  );
  const knownSet = options.sets.some((set) => set.slug === params.setSlug);
  return {
    ...params,
    categorySlug: knownCategory ? params.categorySlug : undefined,
    setSlug: knownSet ? params.setSlug : undefined,
  };
}

export const toOptions = (
  items: ReadonlyArray<{ slug: string; name: string }>,
) => items.map((item) => ({ value: item.slug, label: item.name }));
