import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { getCheckoutGateway } from "@/server/checkout/server";
import { emailDeps } from "@/server/email/server";
import { handleReconcileRequest } from "@/server/payments/cron";
import { revalidateAfterInventoryChange } from "@/server/payments/revalidate";

/**
 * The scheduled run (vercel.json): reconciliation of unresolved Stripe
 * checkouts, then pending and retryable transactional emails, as two
 * independent steps (src/server/payments/cron.ts). Only Vercel Cron, which
 * sends CRON_SECRET, may call it.
 */
export async function GET(request: Request): Promise<Response> {
  return handleReconcileRequest(request, {
    db,
    gateway: getCheckoutGateway(),
    cronSecret: env.cronSecret,
    revalidate: revalidateAfterInventoryChange,
    email: emailDeps,
  });
}
