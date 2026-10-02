import type { PaymentConfig } from "@/lib/env/schema";

/*
 * Links from the admin order page to the payment in the Stripe Dashboard,
 * where refunds are made (PROJECT.md §34, §36). Only the public
 * PaymentIntent ID is used; nothing secret ends up in the URL or the page.
 */

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{1,250}$/;

/** Live keys mean the live Dashboard; anything else is test mode. */
export function stripeDashboardIsLive(payments: PaymentConfig): boolean {
  return (
    payments.gateway === "stripe" &&
    payments.secretKey !== null &&
    /^(sk|rk)_live_/.test(payments.secretKey)
  );
}

/** The payment's page in the Stripe Dashboard, or null for an odd ID. */
export function stripePaymentUrl(
  paymentIntentId: string | null,
  live: boolean,
): string | null {
  if (!paymentIntentId || !PAYMENT_INTENT_ID.test(paymentIntentId)) {
    return null;
  }
  return `https://dashboard.stripe.com/${live ? "" : "test/"}payments/${paymentIntentId}`;
}
