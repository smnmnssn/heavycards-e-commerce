import { after } from "next/server";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { releaseExpiredReservations } from "@/server/checkout/cleanup";
import { handleCheckoutRequest } from "@/server/checkout/handle-request";
import { getCheckoutGateway } from "@/server/checkout/server";
import { logEmail } from "@/server/email/log";
import { processDueEmails } from "@/server/email/outbox";
import { emailDeps } from "@/server/email/server";
import { reconcileCheckouts } from "@/server/payments/reconcile";
import { revalidateAfterInventoryChange } from "@/server/payments/revalidate";
import { pruneRateLimits } from "@/server/security/rate-limit";

/**
 * Starts Stripe Hosted Checkout for the browser cart: validates it against
 * current data, reserves stock, creates the pending order and returns the
 * payment URL. See src/server/checkout/create-checkout.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const gateway = getCheckoutGateway();
  // Housekeeping after the response: never delays or fails the checkout.
  // Besides the scheduled run, a few overdue checkouts are reconciled here,
  // so stock whose Stripe outcome was missed is freed while customers shop.
  after(async () => {
    const now = new Date();
    try {
      await releaseExpiredReservations(db, now);
      await pruneRateLimits(db, now);
      if (gateway) {
        const summary = await reconcileCheckouts({ db, gateway }, { limit: 3 });
        revalidateAfterInventoryChange(summary.productSlugs);
      }
    } catch (error) {
      console.error("[checkout] reservation cleanup failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    // Separately, so an email problem never affects the cleanup above: a few
    // due or retryable emails (e.g. confirmations of orders reconciled just
    // now), which keeps retries moving between scheduled runs.
    try {
      await processDueEmails(emailDeps, { limit: 3 });
    } catch (error) {
      logEmail("error", "email processing after checkout failed", { error });
    }
  });

  return handleCheckoutRequest(request, {
    db,
    gateway,
    siteUrl: env.siteUrl,
    secret: env.authSecret,
  });
}
