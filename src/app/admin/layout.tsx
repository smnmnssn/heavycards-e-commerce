import type { Metadata } from "next";
import { connection } from "next/server";

import { siteConfig } from "@/lib/config/site";

// Private area: never indexed (also sent as an X-Robots-Tag header).
export const metadata: Metadata = {
  title: {
    default: `${siteConfig.brandName} admin`,
    template: `%s | ${siteConfig.brandName} admin`,
  },
  robots: { index: false, follow: false },
};

/**
 * Every admin page renders per request, never from a prerendered copy: the
 * proxy gives each admin response a fresh CSP nonce (src/proxy.ts), which
 * Next.js can only apply while rendering, and admin pages never belong in
 * a shared cache.
 */
export default async function AdminRootLayout({
  children,
}: LayoutProps<"/admin">) {
  await connection();
  return children;
}
