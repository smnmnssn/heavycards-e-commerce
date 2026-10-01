import type { PaymentStatus } from "@/generated/prisma/enums";
import { formatOrderNumber } from "@/server/domain/order-number";

/*
 * What the success-URL page may say. Payment state comes only from the
 * database (set by verified webhooks), never from the fact that the browser
 * arrived at the URL.
 */

export type CheckoutReturnState =
  | { kind: "processing"; orderNumber: string }
  | { kind: "paid"; orderNumber: string }
  | { kind: "refunded"; orderNumber: string }
  | { kind: "not_completed"; orderNumber: string }
  | { kind: "unknown" };

/** Stripe Checkout Session IDs: "cs_test_…" or "cs_live_…". */
export function parseCheckoutSessionId(value: unknown): string | null {
  return typeof value === "string" &&
    /^cs_(test|live)_[A-Za-z0-9]{1,250}$/.test(value)
    ? value
    : null;
}

export function checkoutReturnState(
  order: { orderNumber: number; paymentStatus: PaymentStatus } | null,
): CheckoutReturnState {
  if (!order) return { kind: "unknown" };
  const orderNumber = formatOrderNumber(order.orderNumber);
  switch (order.paymentStatus) {
    case "PENDING":
      return { kind: "processing", orderNumber };
    case "PAID":
    case "PARTIALLY_REFUNDED":
      return { kind: "paid", orderNumber };
    case "REFUNDED":
      return { kind: "refunded", orderNumber };
    case "FAILED":
    case "EXPIRED":
      return { kind: "not_completed", orderNumber };
  }
}
