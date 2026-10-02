import type { MetadataRoute } from "next";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { buildSitemap } from "@/server/catalog/sitemap";
import { getSitemapData } from "@/server/data/catalog-queries";

// Served from cache and refreshed at most hourly; catalog changes in admin
// refresh it at once (src/server/admin/catalog/revalidation.ts).
export const revalidate = 3600;

/** sitemap.xml (policy in src/server/catalog/sitemap.ts). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(env.siteUrl, await getSitemapData(db, new Date()));
}
