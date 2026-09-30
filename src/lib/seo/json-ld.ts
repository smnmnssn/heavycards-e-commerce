/*
 * JSON-LD structured data (basic; completed in Milestone 13). Values must
 * mirror what the page visibly shows: same price, availability and ratings.
 */

export type JsonLd = Record<string, unknown>;

/**
 * Serializes JSON-LD for a <script> tag. `<` is escaped so content such as a
 * product name containing "</script>" can never break out of the tag.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
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
