import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * A full Content-Security-Policy is deliberately deferred until the Stripe,
 * image storage and analytics origins are known; `frame-ancestors` is safe to
 * enforce on its own now. HSTS is provided by Vercel for HTTPS deployments.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin", headers: adminHeaders },
      { source: "/admin/:path*", headers: adminHeaders },
      { source: "/api/:path*", headers: noIndexHeaders },
    ];
  },
};

export default nextConfig;
