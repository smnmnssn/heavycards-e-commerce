import { absoluteUrl, type JsonLd } from "@/lib/seo/json-ld";
import type { ProductDetail } from "@/server/data/catalog-queries";
import type { AvailabilityState } from "@/server/domain/catalog";

import { productPath } from "./presenters";

const schemaAvailability: Partial<Record<AvailabilityState, string>> = {
  in_stock: "https://schema.org/InStock",
  low_stock: "https://schema.org/LimitedAvailability",
  sold_out: "https://schema.org/OutOfStock",
  preorder: "https://schema.org/PreOrder",
  preorder_sold_out: "https://schema.org/OutOfStock",
};

/** Exact decimal string from minor units: 74950 → "749.50" (no floats). */
export function schemaPrice(amount: number): string {
  return `${Math.trunc(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

/** Most recent approved reviews included in structured data. */
const MAX_JSON_LD_REVIEWS = 5;

const RATING_SCALE = { bestRating: 5, worstRating: 1 } as const;

/** Rounded like the visible summary ("4,5 av 5"): at most one decimal. */
const roundRating = (rating: number) => Math.round(rating * 10) / 10;

/**
 * Product structured data (PROJECT.md §63). Mirrors the visible page and the
 * authoritative storefront data:
 * - the offer uses the displayed price and the same availability state as
 *   the purchase panel; no offer while a product cannot be ordered yet
 *   (coming soon without preorder), since there is nothing to buy;
 * - a preorder's offer starts on its displayed release date;
 * - condition "new" is stated only for sealed products, the one type whose
 *   condition is known by definition;
 * - ratings and reviews come only from APPROVED reviews (the page's own
 *   summary and list);
 * - no brand, GTIN, shipping or return policy: HeavyCards does not record
 *   them, so they are not claimed.
 * Archived products have no structured data (their page is noindex).
 */
export function productJsonLd({
  siteUrl,
  product,
  state,
  description,
}: {
  siteUrl: string;
  product: ProductDetail;
  state: AvailabilityState;
  description: string;
}): JsonLd {
  const url = absoluteUrl(siteUrl, productPath(product.slug));
  const availability = schemaAvailability[state];
  const { count, averageRating } = product.reviewSummary;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description,
    url,
    sku: product.sku,
    category: product.category.name,
    ...(product.releaseDate ? { releaseDate: product.releaseDate } : {}),
    ...(product.images.length > 0
      ? {
          image: product.images.map((image) => absoluteUrl(siteUrl, image.url)),
        }
      : {}),
    ...(availability
      ? {
          offers: {
            "@type": "Offer",
            url,
            price: schemaPrice(product.priceAmount),
            priceCurrency: "SEK",
            availability,
            ...(state === "preorder" && product.releaseDate
              ? { availabilityStarts: product.releaseDate }
              : {}),
            ...(product.productType === "SEALED"
              ? { itemCondition: "https://schema.org/NewCondition" }
              : {}),
          },
        }
      : {}),
    ...(count > 0 && averageRating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: roundRating(averageRating),
            reviewCount: count,
            ...RATING_SCALE,
          },
          review: product.reviews
            .slice(0, MAX_JSON_LD_REVIEWS)
            .map((review) => ({
              "@type": "Review",
              author: { "@type": "Person", name: review.displayName },
              datePublished: review.createdAt.toISOString().slice(0, 10),
              reviewBody: review.body,
              ...(review.title ? { name: review.title } : {}),
              reviewRating: {
                "@type": "Rating",
                ratingValue: review.rating,
                ...RATING_SCALE,
              },
            })),
        }
      : {}),
  };
}
