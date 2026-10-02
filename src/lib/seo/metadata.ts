import type { Metadata } from "next";

import { brandRasterAssets } from "@/lib/config/brand";
import { siteConfig } from "@/lib/config/site";

/** `sv-SE` in Open Graph notation. */
export const OPEN_GRAPH_LOCALE = "sv_SE";

/*
 * Metadata helpers. Stored seoTitle/seoDescription always win; otherwise
 * defaults are generated from content so admins never have to write SEO
 * fields to publish a valid page (PROJECT.md §54, §62).
 */

export const META_DESCRIPTION_MAX = 160;

/** Plain-text excerpt cut at a word boundary, for meta descriptions. */
export function excerpt(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** First non-empty candidate, trimmed; used for title/description fallbacks. */
export function firstText(
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Listing pages after the first get distinct titles ("Tins – sida 2"). */
export function pagedTitle(title: string, page = 1): string {
  return page > 1 ? `${title} – sida ${page}` : title;
}

export type ShareImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
};

/** Social preview for pages without product imagery: the brand mark. */
export const DEFAULT_SHARE_IMAGE: ShareImage = {
  url: brandRasterAssets.share.src,
  width: brandRasterAssets.share.width,
  height: brandRasterAssets.share.height,
  alt: siteConfig.brandName,
};

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  index?: boolean;
  /** Use the title as-is instead of appending "| HeavyCards". */
  absoluteTitle?: boolean;
  /** Product imagery; the brand share image is used when omitted. */
  images?: ShareImage[];
};

/**
 * Consistent title, description, canonical, robots and Open Graph.
 *
 * Next.js replaces (does not merge) a parent's `openGraph` and `robots`, so
 * every page states the shared Open Graph fields itself, and indexable pages
 * leave `robots` out entirely instead of setting it to undefined.
 */
export function pageMetadata({
  title,
  description,
  path,
  index = true,
  absoluteTitle = false,
  images,
}: PageMetadataInput): Metadata {
  const metaDescription = excerpt(description);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description: metaDescription,
    alternates: { canonical: path },
    ...(index ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: siteConfig.brandName,
      locale: OPEN_GRAPH_LOCALE,
      title,
      description: metaDescription,
      url: path,
      images: images ?? [DEFAULT_SHARE_IMAGE],
    },
    // X/Twitter reads the Open Graph tags; only the card type is its own.
    // Square packshots suit the small card, the 1.91:1 brand image the large.
    twitter: { card: images ? "summary" : "summary_large_image" },
  };
}
