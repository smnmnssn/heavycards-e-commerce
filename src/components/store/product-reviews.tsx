import { Badge } from "@/components/ui/badge";
import { formatInstantDate } from "@/lib/dates";
import type { ProductDetail } from "@/server/data/catalog-queries";

import { formatRating, StarRating } from "./star-rating";

export const REVIEWS_SECTION_ID = "recensioner";

/** Compact rating line under the product name; links to the reviews. */
export function ReviewSummaryLink({
  summary,
}: {
  summary: ProductDetail["reviewSummary"];
}) {
  if (summary.count === 0 || summary.averageRating === null) return null;
  return (
    <a
      href={`#${REVIEWS_SECTION_ID}`}
      className="inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline"
    >
      <StarRating rating={summary.averageRating} size="sm" />
      <span>
        {formatRating(summary.averageRating)} ·{" "}
        {summary.count === 1 ? "1 recension" : `${summary.count} recensioner`}
      </span>
    </a>
  );
}

/**
 * Approved reviews only (the query never loads others). Review text is
 * rendered as plain text, never as HTML.
 */
export function ProductReviews({
  reviews,
  summary,
}: {
  reviews: ProductDetail["reviews"];
  summary: ProductDetail["reviewSummary"];
}) {
  return (
    <section
      id={REVIEWS_SECTION_ID}
      aria-labelledby={`${REVIEWS_SECTION_ID}-rubrik`}
      className="scroll-mt-24"
    >
      <h2 id={`${REVIEWS_SECTION_ID}-rubrik`} className="type-h2">
        Recensioner
      </h2>

      {summary.count === 0 || summary.averageRating === null ? (
        <p className="mt-4 text-muted-foreground">
          Inga recensioner ännu. Kunder som har köpt produkten kan lämna en
          recension via länken i leveransbeskedet.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <StarRating rating={summary.averageRating} />
            <p className="text-sm">
              <span className="font-semibold">
                {formatRating(summary.averageRating)} av 5
              </span>{" "}
              <span className="text-muted-foreground">
                baserat på{" "}
                {summary.count === 1
                  ? "1 recension"
                  : `${summary.count} recensioner`}
              </span>
            </p>
          </div>

          <ul className="mt-8 divide-y divide-border border-y border-border">
            {reviews.map((review) => (
              <li key={review.id} className="py-6">
                <article className="max-w-prose">
                  <div className="flex flex-wrap items-center gap-3">
                    <StarRating rating={review.rating} size="sm" />
                    {review.verifiedPurchase && (
                      <Badge variant="muted">Verifierat köp</Badge>
                    )}
                  </div>
                  {review.title && (
                    <h3 className="mt-3 font-semibold">{review.title}</h3>
                  )}
                  <p className="mt-2 whitespace-pre-line">{review.body}</p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {review.displayName} ·{" "}
                    <time dateTime={review.createdAt.toISOString()}>
                      {formatInstantDate(review.createdAt)}
                    </time>
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
