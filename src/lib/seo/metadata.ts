import type { Metadata } from "next";

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

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  index?: boolean;
  /** Use the title as-is instead of appending "| HeavyCards". */
  absoluteTitle?: boolean;
  images?: Array<{ url: string; width: number; height: number; alt: string }>;
};

/** Consistent title, description, canonical, robots and Open Graph. */
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
    robots: index ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description: metaDescription,
      url: path,
      images,
    },
  };
}
