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
 * refunded. Completing an already shipped order and cancelling are always
 * possible, whatever happened to the payment since.
 */
export function fulfillmentAllowedForPayment(
  to: FulfillmentStatus,
  paymentStatus: PaymentStatus,
): boolean {
  if (to === "PROCESSING" || to === "SHIPPED") {
    return paymentStatus === "PAID" || paymentStatus === "PARTIALLY_REFUNDED";
  }
  return true;
}
