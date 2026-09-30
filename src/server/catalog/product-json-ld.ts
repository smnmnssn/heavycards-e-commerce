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

/**
 * Basic Product structured data (completed in Milestone 13). Mirrors the
 * visible page: the same price, availability and approved reviews only. No
 * offer is emitted while a product cannot be ordered yet (coming soon).
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
    name: product.name,
    description,
    url,
    category: product.category.name,
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
            itemCondition: "https://schema.org/NewCondition",
          },
        }
      : {}),
    ...(count > 0 && averageRating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Math.round(averageRating * 10) / 10,
            reviewCount: count,
            bestRating: 5,
            worstRating: 1,
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
                bestRating: 5,
                worstRating: 1,
              },
            })),
        }
      : {}),
  };
}
