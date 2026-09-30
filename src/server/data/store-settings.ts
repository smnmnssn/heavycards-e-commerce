import "server-only";

import { cache } from "react";

import { db } from "@/lib/db/client";

export type PublicStoreInfo = {
  contactEmail: string | null;
  companyName: string | null;
  organizationNumber: string | null;
  lowStockThreshold: number;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
};

/**
 * Public, non-secret store settings. Missing settings (e.g. a fresh
 * production database before the owner has configured the store) must never
 * break rendering, so every field has a safe fallback.
 *
 * `cache` dedupes the query within one render (layout + page).
 */
export const getPublicStoreInfo = cache(async (): Promise<PublicStoreInfo> => {
  const settings = await db.storeSettings.findUnique({
    where: { id: 1 },
    select: {
      contactEmail: true,
      companyName: true,
      organizationNumber: true,
      lowStockThreshold: true,
      defaultSeoTitle: true,
      defaultSeoDescription: true,
    },
  });
  return {
    contactEmail: settings?.contactEmail ?? null,
    companyName: settings?.companyName ?? null,
    organizationNumber: settings?.organizationNumber ?? null,
    // Without settings no "few left" labels are shown rather than guessing.
    lowStockThreshold: settings?.lowStockThreshold ?? 0,
    defaultSeoTitle: settings?.defaultSeoTitle ?? null,
    defaultSeoDescription: settings?.defaultSeoDescription ?? null,
  };
});
