import { z } from "zod";

import type {
  PrismaClient,
  ProductStatus,
  ReviewStatus,
} from "@/generated/prisma/client";
import { canManageReviews } from "@/lib/auth/authorization";

import { assertActiveAdmin } from "../access";

/*
 * Read side of /admin/reviews. Moderation itself is the Milestone 11
 * service (src/server/reviews/moderation.ts). Nothing here selects review
 * tokens: invitations are not part of a review's data at all.
 */

export const ADMIN_REVIEWS_PAGE_SIZE = 25;

export const REVIEW_STATUS_FILTERS = {
  PENDING: "Väntar på granskning",
  APPROVED: "Godkända",
  REJECTED: "Avvisade",
  alla: "Alla",
} as const;
export type ReviewStatusFilter = keyof typeof REVIEW_STATUS_FILTERS;

export const REVIEW_SORTS = {
  aldst: "Äldst först",
  nyast: "Nyast först",
} as const;
export type ReviewSort = keyof typeof REVIEW_SORTS;

export type AdminReviewListParams = {
  status: ReviewStatusFilter;
  sort: ReviewSort;
  page: number;
};

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const schema = z.object({
  status: z
    .preprocess(
      first,
      z.enum(Object.keys(REVIEW_STATUS_FILTERS) as [ReviewStatusFilter]),
    )
    .catch("PENDING"),
  // Oldest first by default: the queue is worked through in arrival order.
  sortering: z
    .preprocess(first, z.enum(Object.keys(REVIEW_SORTS) as [ReviewSort]))
    .catch("aldst"),
  sida: z.preprocess(first, z.coerce.number().int().min(1).max(1_000)).catch(1),
});

export function parseAdminReviewParams(
  searchParams: Record<string, string | string[] | undefined>,
): AdminReviewListParams {
  const parsed = schema.parse(searchParams);
  return { status: parsed.status, sort: parsed.sortering, page: parsed.sida };
}

export function adminReviewsHref(
  params: AdminReviewListParams,
  overrides: Partial<AdminReviewListParams> = {},
): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.status !== "PENDING") query.set("status", merged.status);
  if (merged.sort !== "aldst") query.set("sortering", merged.sort);
  if (merged.page > 1) query.set("sida", String(merged.page));
  const search = query.toString();
  return search ? `/admin/reviews?${search}` : "/admin/reviews";
}

export type AdminReviewRow = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  displayName: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
  product: { id: string; name: string; slug: string; status: ProductStatus };
  /** The purchase the review is based on (staff context, never public). */
  order: { id: string; orderNumber: number } | null;
};

export type AdminReviewList = {
  rows: AdminReviewRow[];
  total: number;
  page: number;
  pageCount: number;
  counts: Record<ReviewStatus, number>;
};

export async function listAdminReviews(
  client: PrismaClient,
  {
    actorId,
    params,
    pageSize = ADMIN_REVIEWS_PAGE_SIZE,
  }: { actorId: string; params: AdminReviewListParams; pageSize?: number },
): Promise<AdminReviewList> {
  await assertActiveAdmin(
    client,
    actorId,
    canManageReviews,
    "Behörighet saknas för recensioner.",
  );
  const where = params.status === "alla" ? {} : { status: params.status };
  const grouped = await client.review.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<ReviewStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
  };
  for (const row of grouped) counts[row.status] = row._count._all;
  const total =
    params.status === "alla"
      ? counts.PENDING + counts.APPROVED + counts.REJECTED
      : counts[params.status];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, pageCount);

  const reviews = await client.review.findMany({
    where,
    orderBy: [
      { createdAt: params.sort === "aldst" ? "asc" : "desc" },
      { id: params.sort === "aldst" ? "asc" : "desc" },
    ],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      status: true,
      rating: true,
      title: true,
      body: true,
      displayName: true,
      verifiedPurchase: true,
      createdAt: true,
      updatedAt: true,
      product: {
        select: { id: true, name: true, slug: true, status: true },
      },
      orderItem: {
        select: { order: { select: { id: true, orderNumber: true } } },
      },
    },
  });

  return {
    total,
    page,
    pageCount,
    counts,
    rows: reviews.map(({ orderItem, ...review }) => ({
      ...review,
      order: orderItem?.order ?? null,
    })),
  };
}
