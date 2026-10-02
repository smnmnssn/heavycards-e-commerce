import { siteConfig } from "@/lib/config/site";
import { excerpt } from "@/lib/seo/metadata";

import { CharacterCount } from "./form-layout";

/**
 * Hint under an optional SEO field: what a blank field means, then the
 * length guidance.
 */
export function SeoFieldHint({
  whenBlank,
  length,
  recommended,
}: {
  whenBlank: string;
  length: number;
  recommended: number;
}) {
  return (
    <>
      {whenBlank} <CharacterCount length={length} recommended={recommended} />
    </>
  );
}

/** Section intro shared by every form with SEO fields. */
export const SEO_SECTION_DESCRIPTION =
  "Valfritt. Styr hur sidan visas i Google och när länken delas. Lämna fälten tomma så skapas titel och beskrivning automatiskt; det du skriver här ersätter den automatiska texten.";

/**
 * Approximate search-result snippet with the values the storefront will
 * actually output (title template, URL, 160-character description).
 */
export function SeoPreview({
  title,
  description,
  url,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  url: string;
  /** The homepage title is used as-is, without "| HeavyCards". */
  absoluteTitle?: boolean;
}) {
  return (
    <figure className="rounded-md border border-border bg-surface p-4">
      <figcaption className="type-eyebrow text-muted-foreground">
        Förhandsvisning i sökresultat
      </figcaption>
      <p className="mt-3 truncate text-sm text-muted-foreground">{url}</p>
      <p className="mt-1 text-lg leading-snug font-semibold break-words">
        {absoluteTitle ? title : `${title} | ${siteConfig.brandName}`}
      </p>
      <p className="mt-1 text-sm break-words text-muted-foreground">
        {excerpt(description)}
      </p>
    </figure>
  );
}
