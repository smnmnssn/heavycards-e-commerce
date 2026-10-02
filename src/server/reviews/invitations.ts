import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { orderAllowsReviews } from "@/server/domain/review";
import {
  isReviewTokenUsable,
  newReviewInvitation,
  rawReviewToken,
  reviewPath,
  type ReviewLinkKey,
} from "@/server/domain/review-token";

/*
 * Review invitations (PROJECT.md §44–§46): one per shipped order, created
 * with the first SHIPPED transition and linked from the shipping email. The
 * invitation authorizes exactly the lines of its own order; a line's
 * entitlement is consumed by its Review (unique per OrderItem).
 */

type Tx = Prisma.TransactionClient;

/**
 * Records the order's review invitation inside the caller's transaction
 * (the first SHIPPED transition). Idempotent: an existing invitation is
 * kept, so a repeated or concurrent call never mints a second link.
 */
export async function createReviewInvitation(
  tx: Tx,
  {
    orderId,
    reviewLinkKey,
    now,
  }: { orderId: string; reviewLinkKey: ReviewLinkKey; now: Date },
): Promise<void> {
  // ON CONFLICT DO NOTHING on the unique order_id: never aborts the caller.
  await tx.reviewToken.createMany({
    data: [
      { orderId, createdAt: now, ...newReviewInvitation(reviewLinkKey, now) },
    ],
    skipDuplicates: true,
  });
}

export type StoredInvitation = {
  nonce: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type ReviewLink =
  | { ok: true; url: string }
  /** Revoked or expired: the email gets no review section. */
  | { ok: false; reason: "unusable" }
  /** AUTH_SECRET changed since the invitation was created. */
  | { ok: false; reason: "key_mismatch" };

/**
 * The absolute review URL for the shipping email. Deterministic: every
 * render of the same invitation yields the same URL.
 */
export function reviewLinkFor(
  invitation: StoredInvitation,
  {
    reviewLinkKey,
    siteUrl,
    now,
  }: {
    reviewLinkKey: ReviewLinkKey;
    siteUrl: string;
    now: Date;
  },
): ReviewLink {
  if (!isReviewTokenUsable(invitation, now)) {
    return { ok: false, reason: "unusable" };
  }
  const rawToken = rawReviewToken(reviewLinkKey, invitation);
  return rawToken
    ? { ok: true, url: `${siteUrl}${reviewPath(rawToken)}` }
    : { ok: false, reason: "key_mismatch" };
}

export type ReviewableLine = {
  orderItemId: string;
  /** The name the customer bought (snapshot), not today's product name. */
  name: string;
  quantity: number;
  image: {
    url: string;
    altText: string | null;
    width: number;
    height: number;
  } | null;
  reviewed: boolean;
};

export type OpenInvitation = { lines: ReviewableLine[] };

/**
 * Resolves a review URL token. Returns null (one generic answer) when the
 * token is malformed, unknown, revoked or expired, when the order no longer
 * allows reviews, and when every line has been reviewed: the caller cannot
 * tell these apart, and nothing reveals whether an order exists.
 */
export async function findOpenInvitation(
  db: PrismaClient,
  rawToken: unknown,
  now: Date,
): Promise<OpenInvitation | null> {
  if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) {
    return null;
  }
  const invitation = await db.reviewToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      expiresAt: true,
      revokedAt: true,
      order: {
        select: {
          paymentStatus: true,
          fulfillmentStatus: true,
          shippedAt: true,
          items: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              productNameSnapshot: true,
              quantity: true,
              review: { select: { id: true } },
              product: {
                select: {
                  images: {
                    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                    take: 1,
                    select: {
                      url: true,
                      altText: true,
                      width: true,
                      height: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (
    !invitation ||
    !isReviewTokenUsable(invitation, now) ||
    !orderAllowsReviews(invitation.order)
  ) {
    return null;
  }
  const lines = invitation.order.items.map((item) => ({
    orderItemId: item.id,
    name: item.productNameSnapshot,
    quantity: item.quantity,
    image: item.product.images[0] ?? null,
    reviewed: item.review !== null,
  }));
  return lines.some((line) => !line.reviewed) ? { lines } : null;
}
