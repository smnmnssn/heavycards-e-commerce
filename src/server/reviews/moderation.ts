import { z } from "zod";

import type {
  AdminRole,
  PrismaClient,
  ReviewStatus,
} from "@/generated/prisma/client";
import { canManageReviews, ForbiddenError } from "@/lib/auth/authorization";
import { productPath } from "@/lib/catalog-paths";
import { withTransactionRetry } from "@/server/db/transactions";
import {
  canModerate,
  changesPublicReviews,
  moderationTarget,
} from "@/server/domain/review";

/*
 * Review moderation (PROJECT.md §47, §56). The admin UI (Milestone 12)
 * calls this service, or `moderateReviewAndRevalidate` in ./server.ts,
 * which also refreshes the product page.
 *
 * In one transaction: the acting administrator is re-checked (active, may
 * manage reviews), the review row is locked, the transition validated
 * (src/server/domain/review.ts), the status changed and the decision
 * audited. Repeating a decision is a no-op without an audit entry, so
 * double submissions and concurrent moderators cannot duplicate anything.
 * Moderation never creates, deletes or re-opens a review or its
 * entitlement.
 */

export const REVIEW_AUDIT_ACTIONS = {
  approved: "APPROVE_REVIEW",
  rejected: "REJECT_REVIEW",
} as const;

const moderationInputSchema = z.object({
  reviewId: z.uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
});

export type ModerationResult =
  | {
      ok: true;
      /** False when the review already had this status. */
      changed: boolean;
      from: ReviewStatus;
      to: ReviewStatus;
      /** Storefront pages to refresh: non-empty when public state changed. */
      revalidatePaths: string[];
    }
  | { ok: false; error: "INVALID_INPUT" }
  | { ok: false; error: "NOT_FOUND" }
  | {
      ok: false;
      error: "INVALID_TRANSITION";
      from: ReviewStatus;
      to: ReviewStatus;
    };

type LockedReview = {
  id: string;
  status: ReviewStatus;
  productId: string;
  productSlug: string;
};

/**
 * Approves or rejects a review. `input` is untrusted (form data). Throws
 * ForbiddenError when the actor may not manage reviews.
 */
export async function moderateReview(
  db: PrismaClient,
  { actorId, input }: { actorId: string; input: unknown },
): Promise<ModerationResult> {
  const parsed = moderationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { reviewId, decision } = parsed.data;
  const to = moderationTarget(decision);

  return withTransactionRetry(() =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        const [actor] = await tx.$queryRaw<
          Array<{ role: AdminRole; isActive: boolean }>
        >`
          SELECT role::text AS role, is_active AS "isActive"
          FROM admin_users WHERE id = ${actorId}::uuid
          FOR SHARE`;
        if (!actor?.isActive || !canManageReviews(actor)) {
          throw new ForbiddenError("Behörighet saknas för recensioner.");
        }

        const [review] = await tx.$queryRaw<LockedReview[]>`
          SELECT r.id::text AS id,
                 r.status::text AS status,
                 r.product_id::text AS "productId",
                 p.slug AS "productSlug"
          FROM reviews r
          JOIN products p ON p.id = r.product_id
          WHERE r.id = ${reviewId}::uuid
          FOR UPDATE OF r`;
        if (!review) return { ok: false, error: "NOT_FOUND" } as const;
        const from = review.status;

        if (from === to) {
          return { ok: true, changed: false, from, to, revalidatePaths: [] };
        }
        if (!canModerate(from, to)) {
          return { ok: false, error: "INVALID_TRANSITION", from, to } as const;
        }

        await tx.review.update({
          where: { id: review.id },
          data: { status: to },
        });
        await tx.auditLog.create({
          data: {
            adminUserId: actorId,
            action:
              to === "APPROVED"
                ? REVIEW_AUDIT_ACTIONS.approved
                : REVIEW_AUDIT_ACTIONS.rejected,
            entityType: "Review",
            entityId: review.id,
            // Never the review text or anything about the customer.
            metadata: { from, to, productId: review.productId },
          },
        });
        return {
          ok: true,
          changed: true,
          from,
          to,
          revalidatePaths: changesPublicReviews(from, to)
            ? [productPath(review.productSlug)]
            : [],
        };
      },
      { maxWait: 10_000, timeout: 20_000 },
    ),
  );
}
