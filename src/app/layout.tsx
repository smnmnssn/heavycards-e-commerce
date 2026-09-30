import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import { siteConfig } from "@/lib/config/site";
import { env } from "@/lib/env/server";

import "./globals.css";

// One variable font file for the whole site. The width axis provides the
// expanded display style; next/font self-hosts it (no requests to Google at
// runtime) and sizes the fallback font to avoid layout shift.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

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

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={siteConfig.htmlLang} className={archivo.variable}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
