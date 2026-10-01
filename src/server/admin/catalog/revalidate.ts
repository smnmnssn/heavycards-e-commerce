import "server-only";

import { revalidatePath } from "next/cache";

import { catalogRevalidationTargets } from "./revalidation";

/** Marks storefront pages affected by a catalog change as stale. */
export function revalidateCatalog(productSlugs: readonly string[] = []) {
  for (const { path, type } of catalogRevalidationTargets(productSlugs)) {
    revalidatePath(path, type);
  }
}
