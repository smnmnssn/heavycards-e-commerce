import type { ProductStatus } from "@/generated/prisma/enums";
import type { IsoDate } from "@/lib/dates";

/*
 * Storefront catalog rules. These pure functions define the behavior; the
 * SQL in src/server/data/catalog-queries.ts implements the same rules for
 * filtering and paging, and DB tests assert that both agree.
 */

/** "Nyheter" shows ACTIVE products first published within this window. */
export const NEW_ARRIVALS_WINDOW_DAYS = 60;

/** Product cards show a "Nyhet" badge for this long after publishing. */
export const NEW_BADGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type VisibilityInput = {
  status: ProductStatus;
  publishedAt: Date | null;
};

/**
 * Publicly listed (listings, search, homepage): ACTIVE or COMING_SOON and
 * published (publishedAt set and not in the future). DRAFT is never public.
 * ARCHIVED is never listed.
 */
export function isListable(product: VisibilityInput, now: Date): boolean {
  return (
    (product.status === "ACTIVE" || product.status === "COMING_SOON") &&
    product.publishedAt !== null &&
    product.publishedAt.getTime() <= now.getTime()
  );
}

/**
 * Whether a product page may be shown. Archived products that were once
 * published keep their page as a "no longer sold" notice (noindex), so old
 * links, orders and reviews do not dead-end.
 */
export function hasPublicPage(product: VisibilityInput, now: Date): boolean {
  if (product.status === "ARCHIVED") {
    return product.publishedAt !== null;
  }
  return isListable(product, now);
}

export type AvailabilityState =
  | "in_stock"
  | "low_stock"
  | "sold_out"
  | "preorder"
  | "preorder_sold_out"
  | "coming_soon"
  | "discontinued";

export type AvailabilityInput = {
  status: ProductStatus;
  isPreorder: boolean;
  /** stockOnHand − holding reservations (never negative). */
  availableQuantity: number;
  lowStockThreshold: number;
};

/**
 * Derives the storefront availability state. Exact quantities are never
 * shown to customers; "low stock" only signals that few are left.
 *
 * - ARCHIVED → discontinued (not purchasable)
 * - isPreorder (ACTIVE or COMING_SOON) → preorder while units are available
 * - COMING_SOON without preorder → coming soon (not purchasable)
 * - ACTIVE → in stock / low stock / sold out
 */
export function getAvailability(input: AvailabilityInput): AvailabilityState {
  const { status, isPreorder, availableQuantity, lowStockThreshold } = input;

  if (status === "ARCHIVED" || status === "DRAFT") {
    return "discontinued";
  }
  if (isPreorder) {
    return availableQuantity > 0 ? "preorder" : "preorder_sold_out";
  }
  if (status === "COMING_SOON") {
    return "coming_soon";
  }
  if (availableQuantity <= 0) {
    return "sold_out";
  }
  return availableQuantity <= lowStockThreshold ? "low_stock" : "in_stock";
}

export function isPurchasable(state: AvailabilityState): boolean {
  return state === "in_stock" || state === "low_stock" || state === "preorder";
}

/** Customer-facing Swedish labels. */
export const availabilityLabels: Readonly<Record<AvailabilityState, string>> = {
  in_stock: "I lager",
  low_stock: "Få kvar i lager",
  sold_out: "Slutsåld",
  preorder: "Förbeställ",
  preorder_sold_out: "Förbeställningar slutsålda",
  coming_soon: "Kommer snart",
  discontinued: "Säljs inte längre",
};

export function isNewArrival(publishedAt: Date | null, now: Date): boolean {
  return (
    publishedAt !== null &&
    publishedAt.getTime() <= now.getTime() &&
    now.getTime() - publishedAt.getTime() < NEW_BADGE_DAYS * DAY_MS
  );
}

export function newArrivalsSince(now: Date): Date {
  return new Date(now.getTime() - NEW_ARRIVALS_WINDOW_DAYS * DAY_MS);
}

/** Whether a release date lies after `today` (both ISO dates). */
export function isFutureRelease(
  releaseDate: IsoDate | null,
  today: IsoDate,
): boolean {
  return releaseDate !== null && releaseDate > today;
}
