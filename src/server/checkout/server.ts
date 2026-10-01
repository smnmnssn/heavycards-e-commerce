import "server-only";

import { env } from "@/lib/env/server";

import { FakeCheckoutGateway } from "./fake-gateway";
import type { CheckoutGateway } from "./gateway";
import { StripeCheckoutGateway } from "./stripe-gateway";

// One instance per server process. The fake keeps its sessions in memory, so
// it must survive module re-evaluation in development as well.
const globalForCheckout = globalThis as typeof globalThis & {
  checkoutGateway?: CheckoutGateway;
};

/**
 * The configured payment gateway, or null when Stripe has no secret key
 * (local development without Stripe): checkout then answers "payment
 * unavailable" while the rest of the store keeps working.
 */
export function getCheckoutGateway(): CheckoutGateway | null {
  const config = env.payments;
  if (config.gateway === "stripe" && !config.secretKey) return null;
  globalForCheckout.checkoutGateway ??=
    config.gateway === "fake"
      ? new FakeCheckoutGateway()
      : StripeCheckoutGateway.fromSecretKey(config.secretKey!);
  return globalForCheckout.checkoutGateway;
}
