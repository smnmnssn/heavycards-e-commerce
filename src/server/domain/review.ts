import type {
  FulfillmentStatus,
  PaymentStatus,
  ReviewStatus,
} from "@/generated/prisma/enums";

/*
 * Review rules (PROJECT.md §42–§47).
 *
 * Moderation: a new review is PENDING and never public. Staff approve or
 * reject it; a decision can be reversed (an approved review that turns out
 * to be inappropriate is rejected, a mistaken rejection approved). Nothing
 * returns to PENDING. Only APPROVED reviews are public and count toward
 * ratings, so a change to or from APPROVED changes the storefront.
 */

export type ModerationDecision = "APPROVE" | "REJECT";

const TARGET: Readonly<Record<ModerationDecision, ReviewStatus>> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
};

const ALLOWED: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["REJECTED"],
  REJECTED: ["APPROVED"],
};

export const moderationTarget = (decision: ModerationDecision) =>
  TARGET[decision];

export function canModerate(from: ReviewStatus, to: ReviewStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** True when the change alters what the storefront shows. */
export function changesPublicReviews(
  from: ReviewStatus,
  to: ReviewStatus,
): boolean {
  return from !== to && (from === "APPROVED" || to === "APPROVED");
}

/**
 * Payment states of an order that was really paid (refunds since then do
 * not undo the purchase).
 */
const PURCHASED_PAYMENT_STATES: readonly PaymentStatus[] = [
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

/**
 * Whether an order's lines may be reviewed through its invitation: it was
 * paid and has been shipped. A later refund does not withdraw the
 * invitation or a submitted review; moderation decides what is published.
 * Every line of such an order is eligible, once.
 */
export function orderAllowsReviews(order: {
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  shippedAt: Date | null;
}): boolean {
  return (
    PURCHASED_PAYMENT_STATES.includes(order.paymentStatus) &&
    order.shippedAt !== null &&
    (order.fulfillmentStatus === "SHIPPED" ||
      order.fulfillmentStatus === "COMPLETED")
  );
}
