import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { getCheckoutGateway } from "@/server/checkout/server";
import { handleReconcileRequest } from "@/server/payments/cron";
import { revalidateAfterInventoryChange } from "@/server/payments/revalidate";

/**
 * Scheduled reconciliation of unresolved Stripe checkouts (vercel.json).
 * Only Vercel Cron, which sends CRON_SECRET, may call it.
 */
export async function GET(request: Request): Promise<Response> {
  return handleReconcileRequest(request, {
    db,
    gateway: getCheckoutGateway(),
    cronSecret: env.cronSecret,
    revalidate: revalidateAfterInventoryChange,
  });
}
