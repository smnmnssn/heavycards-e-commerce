import type { NextConfig } from "next";

import { contentSecurityPolicy } from "./src/lib/security/content-security-policy";
import { isIndexableDeployment } from "./src/lib/seo/indexing";

/**
 * Security headers applied to every response (Milestone 14 review). HSTS is
 * sent by Vercel for HTTPS deployments (verified at launch, see
 * docs/production-readiness.md).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Pages opened from HeavyCards (or opening it) get no handle on its
  // window; Stripe Checkout is a full-page navigation, not a popup.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * The storefront CSP for every route except /admin, which gets a stricter,
 * nonce-based policy from the proxy (src/lib/security/content-security-policy.ts).
 */
const storefrontCspHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy({
      development: process.env.NODE_ENV === "development",
    }),
  },
];

// Private areas must never be indexed, regardless of links or sitemaps (PROJECT.md §65).
const noIndexHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

// Admin pages: invitation and reset links carry single-use tokens in the
// query string, so no Referer is ever sent from them (later rules override
// the site-wide Referrer-Policy).
const adminHeaders = [
  ...noIndexHeaders,
  { key: "Referrer-Policy", value: "no-referrer" },
];

// Checkout return pages: never indexed, and the Stripe session ID in the
// success URL is never sent onward as a Referer.
const checkoutHeaders = adminHeaders;

// Review pages: the path is a bearer token for the customer's order, so the
// same applies (PROJECT.md §65).
const reviewHeaders = adminHeaders;

// Every deployment except Vercel production (previews, local and CI builds)
// is kept out of search indexes as a whole; robots.txt also disallows
// crawling there (src/lib/seo/indexing.ts).
const deploymentHeaders = isIndexableDeployment(process.env.VERCEL_ENV)
  ? []
  : [{ source: "/:path*", headers: noIndexHeaders }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Only our own image sources are optimized (src/lib/storage):
    // development seed images, locally stored uploads (STORAGE_PROVIDER=local)
    // and public Vercel Blob stores. Query strings are never accepted.
    localPatterns: [
      { pathname: "/brand/**", search: "" },
      { pathname: "/api/media/products/**", search: "" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/products/**",
        search: "",
      },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything but /admin and /admin/**; "/administrator" would match.
      { source: "/:path((?!admin(?:/|$)).*)", headers: storefrontCspHeaders },
      ...deploymentHeaders,
      { source: "/admin", headers: adminHeaders },
      { source: "/admin/:path*", headers: adminHeaders },
      { source: "/kassa/:path*", headers: checkoutHeaders },
      { source: "/review/:path*", headers: reviewHeaders },
      { source: "/api/:path*", headers: noIndexHeaders },
    ];
  },
};

export default nextConfig;
