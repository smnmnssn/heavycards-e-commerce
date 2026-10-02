import type {
  ProductCardBadge,
  ProductCardData,
} from "@/components/store/product-card";
import { productPath } from "@/lib/catalog-paths";
import { formatIsoDate, type IsoDate } from "@/lib/dates";
import { excerpt } from "@/lib/seo/metadata";
import type { ProductSummary } from "@/server/data/catalog-queries";
import {
  availabilityLabels,
  getAvailability,
  isFutureRelease,
  isNewArrival,
  isPurchasable,
  type AvailabilityState,
} from "@/server/domain/catalog";

/*
 * Maps catalog data to presentational props. Keeping this out of the React
 * components means the storefront rules (badges, notes, alt text) are unit
 * testable and identical on every page.
 */

export type PresentationContext = {
  now: Date;
  today: IsoDate;
  lowStockThreshold: number;
};

export { productPath } from "@/lib/catalog-paths";

/** Admin alt text wins; otherwise a sensible default from the name (§67). */
export function imageAlt(
  altText: string | null,
  productName: string,
  index = 0,
): string {
  if (altText?.trim()) return altText.trim();
  return index === 0 ? productName : `${productName}, bild ${index + 1}`;
}

/** Plain-text paragraphs: a blank line in admin text starts a new one. */
export function toParagraphs(text: string | null): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Longest landing-page lead before it is shortened (full text follows). */
export const LANDING_LEAD_MAX = 400;

/**
 * Category/set landing copy (the admin "Beskrivning"). The first paragraph
 * leads the page above the products; the full text, when there is more,
 * follows the products, so a long text gives the page real content without
 * pushing the products down. Without a description the generated fallback
 * sentence is the lead.
 */
export function landingCopy(
  description: string | null,
  fallback: string,
): { lead: string; body: string[] } {
  const paragraphs = toParagraphs(description);
  const [first, ...rest] = paragraphs;
  if (!first) return { lead: fallback, body: [] };
  const lead = excerpt(first, LANDING_LEAD_MAX);
  if (lead !== first) return { lead, body: paragraphs };
  return { lead, body: rest };
}

const stateBadges: Partial<Record<AvailabilityState, ProductCardBadge>> = {
  sold_out: { label: availabilityLabels.sold_out, variant: "muted" },
  preorder_sold_out: { label: availabilityLabels.sold_out, variant: "muted" },
  preorder: { label: availabilityLabels.preorder, variant: "solid" },
  coming_soon: { label: availabilityLabels.coming_soon, variant: "outline" },
  low_stock: { label: "Få kvar", variant: "outline" },
};

/** "Släpps 14 november 2026" for future releases, nothing otherwise. */
export function releaseNote(
  releaseDate: IsoDate | null,
  today: IsoDate,
): string | null {
  return isFutureRelease(releaseDate, today)
    ? `Släpps ${formatIsoDate(releaseDate!)}`
    : null;
}

export function toProductCardData(
  product: ProductSummary,
  context: PresentationContext,
): ProductCardData {
  const state = getAvailability({
    status: product.status,
    isPreorder: product.isPreorder,
    availableQuantity: product.availableQuantity,
    lowStockThreshold: context.lowStockThreshold,
  });

  const badges: ProductCardBadge[] = [];
  const stateBadge = stateBadges[state];
  if (stateBadge) badges.push(stateBadge);
  const inStock = state === "in_stock" || state === "low_stock";
  if (inStock && isNewArrival(product.publishedAt, context.now)) {
    badges.push({ label: "Nyhet", variant: "outline" });
  }

  return {
    href: productPath(product.slug),
    name: product.name,
    subtitle: product.setName,
    priceAmount: product.priceAmount,
    compareAtPriceAmount: product.compareAtPriceAmount,
    image: product.image
      ? {
          src: product.image.url,
          alt: imageAlt(product.image.altText, product.name),
          width: product.image.width,
          height: product.image.height,
        }
      : null,
    badges: badges.slice(0, 2),
    unavailable: !isPurchasable(state),
    note: releaseNote(product.releaseDate, context.today),
  };
}
