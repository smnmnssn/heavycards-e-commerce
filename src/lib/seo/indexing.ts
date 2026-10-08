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

const NO_INDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

/** A Next.js `headers()` rule (next.config.ts). */
export type HeaderRule = {
  source: string;
  missing?: Array<{ type: "host"; value: string }>;
  headers: Array<{ key: string; value: string }>;
};

/**
 * Deployment-level `X-Robots-Tag` rules for next.config.ts.
 *
 * - Previews, local and CI builds: every response is noindex.
 * - Production: only the canonical host (`APP_URL`) may be indexed. The same
 *   production deployment also answers on its `*.vercel.app` alias, its
 *   deployment URLs and any domain not redirected to the canonical one
 *   (e.g. `www`); those responses are noindex, so they can never become a
 *   duplicate of the store even before the Vercel redirects are configured
 *   (Milestone 15). Without a usable APP_URL everything is noindex (the
 *   environment validation fails such a build anyway).
 */
export function deploymentRobotsHeaderRules({
  vercelEnv,
  appUrl,
}: {
  vercelEnv: string | undefined;
  appUrl: string | undefined;
}): HeaderRule[] {
  const everything: HeaderRule = { source: "/:path*", headers: NO_INDEX };
  if (!isIndexableDeployment(vercelEnv)) return [everything];
  let hostname: string;
  try {
    hostname = new URL(appUrl ?? "").hostname;
  } catch {
    return [everything];
  }
  // Next.js anchors the pattern (^…$) and compares the lower-cased host
  // without its port.
  const pattern = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [{ ...everything, missing: [{ type: "host", value: pattern }] }];
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
