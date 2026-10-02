import type {
  FulfillmentStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";

/**
 * Allowed fulfillment transitions (PROJECT.md §29, §39). Fulfillment is
 * independent of payment status; whether an order may be fulfilled at all
 * (e.g. only when paid) is checked by the order service, not here.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<FulfillmentStatus, readonly FulfillmentStatus[]>
> = {
  NEW: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedFulfillmentTransitions(
  from: FulfillmentStatus,
): readonly FulfillmentStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Payment precondition for a fulfillment target. Work on an order (handling,
 * shipping) only starts once HeavyCards considers it paid and not fully
 * refunded. Completing an already shipped order is always possible,
 * whatever happened to the payment since.
 *
 * Cancelling is possible once the payment has an outcome, but never while
 * it is PENDING (Milestone 14): Stripe may still complete that checkout, and
 * a payment arriving for a cancelled order would be taken without anything
 * being shipped or flagged. A pending order ends through Stripe's answer
 * (paid, expired or failed), never through a fulfillment change. The
 * database enforces the same rule (orders_pending_unfulfilled_check).
 */
export function fulfillmentAllowedForPayment(
  to: FulfillmentStatus,
  paymentStatus: PaymentStatus,
): boolean {
  if (to === "PROCESSING" || to === "SHIPPED") {
    return paymentStatus === "PAID" || paymentStatus === "PARTIALLY_REFUNDED";
  }
  if (to === "CANCELLED") return paymentStatus !== "PENDING";
  return true;
}
