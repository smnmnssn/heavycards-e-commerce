import type { MetadataRoute } from "next";

/*
 * Deployment-level indexing policy (PROJECT.md §65, §84). Only the Vercel
 * production deployment may be crawled and indexed. Previews, local builds
 * and CI must never become an indexable duplicate of the store.
 *
 * Deliberately free of framework/server imports: next.config.ts uses it too.
 * Like every other environment decision in this project, it is taken when
 * the deployment is built (Vercel builds each preview and production
 * deployment with its own VERCEL_ENV).
 */

export function isIndexableDeployment(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

/**
 * Paths crawlers have no business fetching on production. Pages that carry a
 * private token or session in their URL (`/review/*`, `/kassa/*`) and search
 * results (`/sok`) are deliberately *not* listed: they send `noindex`, and a
 * crawler can only see that if it may fetch them. A robots.txt block would
 * still let a leaked URL appear in results without content.
 */
export const PRODUCTION_DISALLOW = ["/admin", "/api/"] as const;

/** robots.txt: crawl everything public on production, nothing elsewhere. */
export function robotsFor({
  indexable,
  siteUrl,
}: {
  indexable: boolean;
  siteUrl: string;
}): MetadataRoute.Robots {
  if (!indexable) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRODUCTION_DISALLOW],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
