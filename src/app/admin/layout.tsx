import type { Metadata } from "next";

import { siteConfig } from "@/lib/config/site";

// Private area: never indexed (also sent as an X-Robots-Tag header).
export const metadata: Metadata = {
  title: {
    default: `${siteConfig.brandName} admin`,
    template: `%s | ${siteConfig.brandName} admin`,
  },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
