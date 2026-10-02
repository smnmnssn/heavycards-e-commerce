import type { RevalidationTarget } from "@/server/admin/catalog/revalidation";
import type { StoreSettingsData } from "@/lib/validation/store-settings";

/*
 * Storefront cache refresh after a store-settings change (PROJECT.md §92).
 *
 * - Footer details (customer-service email, company name, org.nr) are on
 *   every store page, and the low-stock threshold decides the "Få kvar"
 *   labels on every listing and product page: the whole store layout.
 * - The default SEO title and description are the homepage's metadata.
 * - Shipping price, free-shipping threshold, carrier and VAT are read live
 *   by checkout (inside its transaction), and the store name only by the
 *   email templates at send time, so no cached page shows them.
 *
 * `{ path: "/", type: "layout" }` invalidates the root layout and every
 * page below it; pages re-render on their next visit.
 */

type Field = keyof StoreSettingsData;

const STORE_WIDE: readonly Field[] = [
  "contactEmail",
  "companyName",
  "organizationNumber",
  "lowStockThreshold",
];
const HOMEPAGE: readonly Field[] = ["defaultSeoTitle", "defaultSeoDescription"];

export function storeSettingsRevalidationTargets(
  changed: readonly string[],
): RevalidationTarget[] {
  if (changed.some((field) => STORE_WIDE.includes(field as Field))) {
    return [{ path: "/", type: "layout" }];
  }
  if (changed.some((field) => HOMEPAGE.includes(field as Field))) {
    return [{ path: "/" }];
  }
  return [];
}
