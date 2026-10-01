import { siteConfig } from "@/lib/config/site";
import { excerpt } from "@/lib/seo/metadata";

/**
 * Approximate search-result snippet with the values the storefront will
 * actually output (title template, URL, 160-character description).
 */
export function SeoPreview({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  return (
    <figure className="rounded-md border border-border bg-surface p-4">
      <figcaption className="type-eyebrow text-muted-foreground">
        Förhandsvisning i sökresultat
      </figcaption>
      <p className="mt-3 truncate text-sm text-muted-foreground">{url}</p>
      <p className="mt-1 text-lg leading-snug font-semibold break-words">
        {title} | {siteConfig.brandName}
      </p>
      <p className="mt-1 text-sm break-words text-muted-foreground">
        {excerpt(description)}
      </p>
    </figure>
  );
}
