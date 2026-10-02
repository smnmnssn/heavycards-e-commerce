import { siteConfig } from "@/lib/config/site";

/*
 * JSON-LD structured data (PROJECT.md §63). Values must mirror what the page
 * visibly shows: same names, prices, availability and ratings. Nothing is
 * emitted that HeavyCards does not actually know (no brand, GTIN, shipping
 * or return-policy claims).
 */

export type JsonLd = Record<string, unknown>;

// <, >, & and the JavaScript line separators U+2028 and U+2029.
const SCRIPT_UNSAFE = new RegExp(
  `[<>&${String.fromCharCode(0x2028, 0x2029)}]`,
  "g",
);

/**
 * Serializes JSON-LD for a <script> tag. Characters that could end the tag or
 * open an HTML comment (`<`, `>`, `&`) and the JavaScript line separators are
 * written as \u escapes, so content such as a product name or review text
 * containing "</script>" can never break out of the tag. The result is still
 * plain JSON that parses to the same data.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(
    SCRIPT_UNSAFE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).toString();
}

export function breadcrumbJsonLd(
  siteUrl: string,
  items: ReadonlyArray<{ label: string; href?: string }>,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(siteUrl, item.href) } : {}),
    })),
  };
}

const organizationId = (siteUrl: string) => `${siteUrl}/#organization`;
const websiteId = (siteUrl: string) => `${siteUrl}/#website`;

/**
 * Homepage Organization and WebSite nodes. Optional company details come
 * from store settings and are left out while unset. No SearchAction: Google
 * no longer shows the sitelinks search box, and search pages are noindex.
 */
export function storeIdentityJsonLd({
  siteUrl,
  logoPath,
  legalName,
  email,
}: {
  siteUrl: string;
  logoPath: string;
  legalName: string | null;
  email: string | null;
}): JsonLd[] {
  const home = absoluteUrl(siteUrl, "/");
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organizationId(siteUrl),
      name: siteConfig.brandName,
      url: home,
      logo: absoluteUrl(siteUrl, logoPath),
      ...(legalName ? { legalName } : {}),
      ...(email ? { email } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": websiteId(siteUrl),
      name: siteConfig.brandName,
      url: home,
      inLanguage: siteConfig.locale,
      publisher: { "@id": organizationId(siteUrl) },
    },
  ];
}

/**
 * A category, set or catalog landing page: the page itself plus the products
 * listed on it, in the order shown. `numberOfItems` is the listing total the
 * page displays ("12 produkter"); `offset` is the position before the first
 * item on this page.
 */
export function collectionPageJsonLd({
  siteUrl,
  path,
  name,
  description,
  numberOfItems,
  offset = 0,
  items,
}: {
  siteUrl: string;
  path: string;
  name: string;
  description: string;
  numberOfItems: number;
  offset?: number;
  items: ReadonlyArray<{ name: string; href: string }>;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: absoluteUrl(siteUrl, path),
    inLanguage: siteConfig.locale,
    isPartOf: { "@id": websiteId(siteUrl) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: offset + index + 1,
        name: item.name,
        url: absoluteUrl(siteUrl, item.href),
      })),
    },
  };
}
