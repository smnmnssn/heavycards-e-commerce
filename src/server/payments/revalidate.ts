import "server-only";

import { revalidateCatalog } from "@/server/admin/catalog/revalidate";

import { logPayment } from "./log";

/**
 * Payment finalization and released reservations change availability, so
 * the same storefront pages as a catalog edit are refreshed (the Milestone 7
 * targets: homepage, listings, category and set pages, and the products'
 * own pages). Refunds change no inventory and never call this. A failure
 * here only delays freshness by the 60 s ISR window; it never fails the
 * payment processing.
 */
export function revalidateAfterInventoryChange(productSlugs: string[]) {
  if (productSlugs.length === 0) return;
  try {
    revalidateCatalog([...new Set(productSlugs)]);
  } catch (error) {
    logPayment("error", "storefront revalidation failed", { error });
  }
}
