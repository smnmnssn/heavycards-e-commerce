import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { getCheckoutGateway } from "@/server/checkout/server";
import { sendOrderEmailsAfterResponse } from "@/server/email/server";
import { revalidateAfterInventoryChange } from "@/server/payments/revalidate";
import { handleStripeWebhook } from "@/server/payments/webhook";

/**
 * Stripe webhook endpoint. Signature verification, idempotency and the
 * handled events are described in src/server/payments/webhook.ts.
 */
export async function POST(request: Request): Promise<Response> {
  return handleStripeWebhook(request, {
    db,
    gateway: getCheckoutGateway(),
    webhookSecret: env.payments.webhookSecret,
    revalidate: revalidateAfterInventoryChange,
    sendOrderEmails: sendOrderEmailsAfterResponse,
  });
}
