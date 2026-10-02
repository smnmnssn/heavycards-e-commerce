import type { PrismaClient } from "@/generated/prisma/client";
import { hashToken, isWellFormedToken } from "@/lib/security/tokens";
import {
  DEFAULT_REVIEW_DISPLAY_NAME,
  reviewFieldErrors,
  reviewSubmissionSchema,
  type ReviewFieldErrors,
} from "@/lib/validation/reviews";
import { isUniqueViolation } from "@/server/db/transactions";
import { orderAllowsReviews } from "@/server/domain/review";
import { isReviewTokenUsable } from "@/server/domain/review-token";

/*
 * Customer review submission through a review invitation (PROJECT.md §43,
 * §46). No account: the URL token is the only credential, and it can only
 * reach the lines of its own order.
 *
 * - The browser names the line (OrderItem ID) it reviews. The line must
 *   belong to the invitation's order; the product, the verified-purchase
 *   marker and the status come from the server, never the request.
 * - One review per line: the INSERT into `reviews` (unique order_item_id)
 *   is the atomic consumption of the entitlement. A double click, a retry
 *   or a concurrent submission either finds the line reviewed or loses on
 *   the unique index; both answer ALREADY_REVIEWED and nothing is created.
 * - Quantity is irrelevant: three of one product are one line, one review.
 * - New reviews are PENDING and never public until approved.
 */

export type SubmitReviewResult =
  | { ok: true; remainingLines: number }
  | { ok: false; error: "INVALID_INPUT"; fieldErrors: ReviewFieldErrors }
  /** Malformed, unknown, revoked or expired link, or a foreign line. */
  | { ok: false; error: "INVALID_LINK" }
  | { ok: false; error: "ALREADY_REVIEWED" };

const INVALID_LINK = { ok: false, error: "INVALID_LINK" } as const;
const ALREADY_REVIEWED = { ok: false, error: "ALREADY_REVIEWED" } as const;

type LockedInvitation = {
  orderId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export async function submitReview(
  db: PrismaClient,
  {
    rawToken,
    input,
    now = new Date(),
  }: { rawToken: unknown; input: unknown; now?: Date },
): Promise<SubmitReviewResult> {
  if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) {
    return INVALID_LINK;
  }
  const parsed = reviewSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: reviewFieldErrors(parsed.error),
    };
  }
  const review = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      // FOR SHARE: a concurrent revocation waits until this review is in.
      const [invitation] = await tx.$queryRaw<LockedInvitation[]>`
        SELECT order_id::text AS "orderId",
               expires_at AS "expiresAt",
               revoked_at AS "revokedAt"
        FROM review_tokens
        WHERE token_hash = ${hashToken(rawToken)}
        FOR SHARE`;
      if (!invitation || !isReviewTokenUsable(invitation, now)) {
        return INVALID_LINK;
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: invitation.orderId },
        select: {
          paymentStatus: true,
          fulfillmentStatus: true,
          shippedAt: true,
        },
      });
      if (!orderAllowsReviews(order)) return INVALID_LINK;

      // Scoped to the invitation's order: another order's line is unknown.
      const line = await tx.orderItem.findFirst({
        where: { id: review.orderItemId, orderId: invitation.orderId },
        select: { id: true, productId: true, review: { select: { id: true } } },
      });
      if (!line) return INVALID_LINK;
      if (line.review) return ALREADY_REVIEWED;

      await tx.review.create({
        data: {
          orderItemId: line.id,
          productId: line.productId,
          rating: review.rating,
          title: review.title,
          body: review.body,
          displayName: review.displayName ?? DEFAULT_REVIEW_DISPLAY_NAME,
          verifiedPurchase: true,
          status: "PENDING",
          createdAt: now,
        },
      });
      const remainingLines = await tx.orderItem.count({
        where: { orderId: invitation.orderId, review: { is: null } },
      });
      return { ok: true, remainingLines } as const;
    });
  } catch (error) {
    // A concurrent submission for the same line committed first.
    if (isUniqueViolation(error)) return ALREADY_REVIEWED;
    throw error;
  }
}
