import type { Metadata } from "next";
import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/catalog/page-header";
import { ForbiddenPanel } from "@/components/admin/forbidden-panel";
import { ModerationButtons } from "@/components/admin/reviews/moderation-buttons";
import { StarRating } from "@/components/store/star-rating";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { ReviewStatus } from "@/generated/prisma/enums";
import { canManageReviews } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { productPath } from "@/lib/catalog-paths";
import { formatInstantDateTime } from "@/lib/dates";
import { db } from "@/lib/db/client";
import { cn } from "@/lib/utils";
import { publicOrderNumber } from "@/server/admin/orders/presenters";
import {
  adminReviewsHref,
  listAdminReviews,
  parseAdminReviewParams,
  REVIEW_SORTS,
  REVIEW_STATUS_FILTERS,
  type AdminReviewRow,
  type ReviewStatusFilter,
} from "@/server/admin/reviews/queries";
import { canModerate } from "@/server/domain/review";

export const metadata: Metadata = { title: "Recensioner" };

const STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: "Väntar",
  APPROVED: "Godkänd",
  REJECTED: "Avvisad",
};
const STATUS_BADGES: Record<ReviewStatus, BadgeVariant> = {
  PENDING: "solid",
  APPROVED: "outline",
  REJECTED: "muted",
};

export default async function AdminReviewsPage({
  searchParams,
}: PageProps<"/admin/reviews">) {
  const admin = await requireAdmin();
  if (!canManageReviews(admin)) {
    return (
      <ForbiddenPanel message="Ditt konto har inte behörighet att moderera recensioner." />
    );
  }

  const params = parseAdminReviewParams(await searchParams);
  const list = await listAdminReviews(db, { actorId: admin.id, params });
  const tabs = Object.entries(REVIEW_STATUS_FILTERS) as Array<
    [ReviewStatusFilter, string]
  >;

  return (
    <div className="grid gap-8">
      <AdminPageHeader eyebrow="Butik" title="Recensioner">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Bara godkända recensioner visas i butiken och räknas in i betyget.
          Avvisa en recension för att ta bort den från butiken; den raderas
          inte, så kunden kan inte recensera samma köp igen.
        </p>
      </AdminPageHeader>

      <nav aria-label="Status" className="-mx-4 sm:mx-0">
        <ul className="flex gap-2 overflow-x-auto px-4 sm:flex-wrap sm:px-0">
          {tabs.map(([status, label]) => {
            const count =
              status === "alla"
                ? list.counts.PENDING +
                  list.counts.APPROVED +
                  list.counts.REJECTED
                : list.counts[status];
            const current = params.status === status;
            return (
              <li key={status} className="shrink-0">
                <Link
                  href={adminReviewsHref(params, { status, page: 1 })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold whitespace-nowrap",
                    current
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background hover:border-foreground",
                  )}
                >
                  {label} ({count})
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="recensionslista" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="recensionslista" className="text-sm text-muted-foreground">
            {list.total} {list.total === 1 ? "recension" : "recensioner"}
            {list.pageCount > 1 && ` · sida ${list.page} av ${list.pageCount}`}
          </h2>
          <p className="flex gap-3 text-sm">
            {Object.entries(REVIEW_SORTS).map(([sort, label]) =>
              params.sort === sort ? (
                <span key={sort} className="font-semibold">
                  {label}
                </span>
              ) : (
                <Link
                  key={sort}
                  href={adminReviewsHref(params, {
                    sort: sort as keyof typeof REVIEW_SORTS,
                    page: 1,
                  })}
                  className="underline underline-offset-4"
                >
                  {label}
                </Link>
              ),
            )}
          </p>
        </div>

        {list.rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-8 text-center text-muted-foreground">
            {params.status === "PENDING"
              ? "Inga recensioner väntar på granskning."
              : "Inga recensioner med den statusen."}
          </p>
        ) : (
          <ul className="grid gap-4">
            {list.rows.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        )}

        {list.pageCount > 1 && (
          <nav aria-label="Sidor" className="flex justify-between gap-3">
            {list.page > 1 ? (
              <ButtonLink
                variant="secondary"
                href={adminReviewsHref(params, { page: list.page - 1 })}
              >
                Föregående
              </ButtonLink>
            ) : (
              <span />
            )}
            {list.page < list.pageCount && (
              <ButtonLink
                variant="secondary"
                href={adminReviewsHref(params, { page: list.page + 1 })}
              >
                Nästa
              </ButtonLink>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}

function ReviewCard({ review }: { review: AdminReviewRow }) {
  const decisions = (["APPROVE", "REJECT"] as const).filter((decision) =>
    canModerate(
      review.status,
      decision === "APPROVE" ? "APPROVED" : "REJECTED",
    ),
  );
  const headingId = `recension-${review.id}`;
  return (
    <li
      data-testid="admin-review"
      className="grid gap-4 rounded-lg border border-border bg-background p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto]"
    >
      <article aria-labelledby={headingId} className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGES[review.status]}>
            {STATUS_LABELS[review.status]}
          </Badge>
          {review.verifiedPurchase && (
            <Badge variant="outline">Verifierat köp</Badge>
          )}
          <StarRating rating={review.rating} size="sm" />
          <span className="text-sm text-muted-foreground">
            {review.rating} av 5
          </span>
        </div>
        <div>
          <h3 id={headingId} className="font-semibold break-words">
            <Link
              href={`/admin/products/${review.product.id}`}
              className="underline-offset-4 hover:underline"
            >
              {review.product.name}
            </Link>
          </h3>
          {review.title && (
            <p className="mt-2 font-semibold break-words">{review.title}</p>
          )}
          {/* Plain text: React escapes it, paragraphs are kept. */}
          <p className="mt-1 break-words whitespace-pre-line">{review.body}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {review.displayName} · inskickad{" "}
          {formatInstantDateTime(review.createdAt)}
          {review.order && (
            <>
              {" · "}
              <Link
                href={`/admin/orders/${review.order.id}`}
                className="underline underline-offset-4"
              >
                {publicOrderNumber(review.order.orderNumber)}
              </Link>
            </>
          )}
          {review.status === "APPROVED" &&
            review.product.status !== "DRAFT" && (
              <>
                {" · "}
                <Link
                  href={productPath(review.product.slug)}
                  className="underline underline-offset-4"
                >
                  Visa i butiken
                </Link>
              </>
            )}
        </p>
      </article>
      {decisions.length > 0 && (
        <div className="lg:min-w-48">
          <ModerationButtons
            reviewId={review.id}
            decisions={[...decisions]}
            label={review.product.name}
          />
        </div>
      )}
    </li>
  );
}
