import { createHash } from "node:crypto";

import type { PaymentStatus } from "@/generated/prisma/enums";
import { formatOrderNumber } from "@/server/domain/order-number";

/*
 * What the success-URL page may say. Payment state comes only from the
 * database (set from Stripe's verified state by webhooks or reconciliation),
 * never from the fact that the browser arrived at the URL. The page is found
 * by the unguessable Stripe session ID, never by the public order number,
 * and shows no personal data: no name, email, phone or address.
 */

export type PurchasedLine = {
  productId: string;
  name: string;
  quantity: number;
};

export type CheckoutReturnState =
  | { kind: "processing"; orderNumber: string }
  | {
      kind: "paid";
      orderNumber: string;
      lines: PurchasedLine[];
      totalAmount: number;
      /**
       * SHA-256 of the checkout attempt ID. The browser that started the
       * checkout holds the raw ID and can recognise its own order (to clear
       * the purchased items from its cart); the hash reveals nothing else.
       */
      attemptHash: string | null;
    }
  | { kind: "refunded"; orderNumber: string }
  | { kind: "expired"; orderNumber: string }
  | { kind: "failed"; orderNumber: string }
  | { kind: "unknown" };

/** Stripe Checkout Session IDs: "cs_test_…" or "cs_live_…". */
export function parseCheckoutSessionId(value: unknown): string | null {
  return typeof value === "string" &&
    /^cs_(test|live)_[A-Za-z0-9]{1,250}$/.test(value)
    ? value
    : null;
}

export type ReturnOrder = {
  orderNumber: number;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  checkoutAttemptId: string | null;
  items: Array<{
    productId: string;
    productNameSnapshot: string;
    quantity: number;
  }>;
};

export function checkoutReturnState(
  order: ReturnOrder | null,
): CheckoutReturnState {
  if (!order) return { kind: "unknown" };
  const orderNumber = formatOrderNumber(order.orderNumber);
  switch (order.paymentStatus) {
    case "PENDING":
      return { kind: "processing", orderNumber };
    case "PAID":
    case "PARTIALLY_REFUNDED":
      return {
        kind: "paid",
        orderNumber,
        totalAmount: order.totalAmount,
        lines: order.items.map((item) => ({
          productId: item.productId,
          name: item.productNameSnapshot,
          quantity: item.quantity,
        })),
        attemptHash: order.checkoutAttemptId
          ? createHash("sha256").update(order.checkoutAttemptId).digest("hex")
          : null,
      };
    case "REFUNDED":
      return { kind: "refunded", orderNumber };
    case "FAILED":
      return { kind: "failed", orderNumber };
    case "EXPIRED":
      return { kind: "expired", orderNumber };
  }
}
