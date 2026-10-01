import { after } from "next/server";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { releaseExpiredReservations } from "@/server/checkout/cleanup";
import { handleCheckoutRequest } from "@/server/checkout/handle-request";
import { getCheckoutGateway } from "@/server/checkout/server";
import { pruneRateLimits } from "@/server/security/rate-limit";

/**
 * Starts Stripe Hosted Checkout for the browser cart: validates it against
 * current data, reserves stock, creates the pending order and returns the
 * payment URL. See src/server/checkout/create-checkout.ts.
 */
export async function POST(request: Request): Promise<Response> {
  // Housekeeping after the response: never delays or fails the checkout.
  after(async () => {
    const now = new Date();
    try {
      await releaseExpiredReservations(db, now);
      await pruneRateLimits(db, now);
    } catch (error) {
      console.error("[checkout] reservation cleanup failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  });

  return handleCheckoutRequest(request, {
    db,
    gateway: getCheckoutGateway(),
    siteUrl: env.siteUrl,
    secret: env.authSecret,
  });
}
