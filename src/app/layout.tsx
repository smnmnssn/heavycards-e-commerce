import type { Metadata } from "next";

import { siteConfig } from "@/lib/config/site";
import { env } from "@/lib/env/server";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: siteConfig.brandName,
    template: `%s | ${siteConfig.brandName}`,
  },
  description: "HeavyCards – förseglade Pokémon TCG-produkter i Sverige.",
  applicationName: siteConfig.brandName,
  openGraph: {
    siteName: siteConfig.brandName,
    locale: "sv_SE",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={siteConfig.htmlLang}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
