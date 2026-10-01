import Stripe from "stripe";

import { logPayment } from "./log";
import { syncRefunds } from "./refund-sync";
import {
  recordEventOnly,
  syncCheckoutSession,
  type PaymentDeps,
  type SyncResult,
} from "./session-sync";

/*
 * POST /api/stripe/webhook (PROJECT.md §31). The signature, verified over the
 * raw request body with STRIPE_WEBHOOK_SECRET, is the security boundary:
 * nothing is read from an unverified request. Even a verified event is only
 * used to learn *which* session or payment changed; its current state is
 * then read from Stripe's API (session-sync.ts, refund-sync.ts).
 *
 * Events handled (subscribe the endpoint to exactly these):
 *
 * | Event                                   | Effect                                        |
 * | --------------------------------------- | --------------------------------------------- |
 * | checkout.session.completed              | finalize if paid; otherwise await the payment |
 * | checkout.session.async_payment_succeeded | finalize (delayed payment methods)            |
 * | checkout.session.async_payment_failed   | release stock, order FAILED                   |
 * | checkout.session.expired                | release stock, order EXPIRED                  |
 * | charge.refunded                         | synchronize refunded amount and status        |
 * | refund.created / .updated / .failed     | synchronize refunded amount and status        |
 *
 * Idempotency: processed event IDs are stored in stripe_events (unique),
 * inserted in the same transaction as the event's effects. A redelivered
 * event is answered 200 without work; two deliveries racing roll the second
 * back. Effects are state-based in any case, so replays change nothing.
 *
 * Responses: 200 when handled or deliberately ignored, 400 for a bad
 * signature, 500/503 when processing could not complete (Stripe retries for
 * up to three days; nothing was released meanwhile).
 */

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
] as const;

/** Stripe events are small; this bounds memory for anything else. */
export const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;

export type WebhookDeps = Omit<PaymentDeps, "gateway"> & {
  gateway: PaymentDeps["gateway"] | null;
  webhookSecret: string | null;
  /** Revalidates storefront pages for products whose availability changed. */
  revalidate?: (productSlugs: string[]) => void;
  /**
   * Sends the order's due emails (its confirmation, once paid) after the
   * response, so Stripe never waits for the mail provider.
   */
  sendOrderEmails?: (orderId: string) => void;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleStripeWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  if (!deps.webhookSecret || !deps.gateway) {
    logPayment("error", "webhook received but payments are not configured", {});
    return json({ error: "not_configured" }, 503);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "invalid_signature" }, 400);

  const payload = await readLimitedText(request, MAX_WEBHOOK_BODY_BYTES);
  if (payload === null) return json({ error: "too_large" }, 413);

  let event: Stripe.Event;
  try {
    // Uses the raw body exactly as received; parsing it first would break
    // the signature. Also enforces Stripe's default timestamp tolerance
    // (5 minutes), which limits replays of captured requests.
    event = Stripe.webhooks.constructEvent(
      payload,
      signature,
      deps.webhookSecret,
    );
  } catch {
    logPayment("error", "webhook signature verification failed", {});
    return json({ error: "invalid_signature" }, 400);
  }

  const paymentDeps: PaymentDeps = { ...deps, gateway: deps.gateway };
  try {
    const seen = await deps.db.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { id: true },
    });
    if (seen) {
      logPayment("info", "duplicate webhook ignored", {
        eventId: event.id,
        eventType: event.type,
      });
      return json({ received: true, duplicate: true });
    }

    const result = await dispatch(paymentDeps, event);
    if (result.productSlugs.length > 0) deps.revalidate?.(result.productSlugs);
    if (result.outcome === "paid" && result.orderId) {
      deps.sendOrderEmails?.(result.orderId);
    }
    logPayment(
      result.outcome === "needs_attention" ? "error" : "info",
      "webhook processed",
      {
        eventId: event.id,
        eventType: event.type,
        orderId: result.orderId,
        outcome: result.outcome,
        duplicate: result.duplicate ?? false,
      },
    );
    return json({ received: true });
  } catch (error) {
    logPayment("error", "webhook processing failed; Stripe will retry", {
      eventId: event.id,
      eventType: event.type,
      error,
    });
    return json({ error: "processing_failed" }, 500);
  }
}

async function dispatch(
  deps: PaymentDeps,
  event: Stripe.Event,
): Promise<SyncResult> {
  const ref = { id: event.id, type: event.type };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return syncCheckoutSession(deps, event.data.object.id, {
        source: "webhook",
        event: ref,
      });

    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const intent = event.data.object.payment_intent;
      const paymentIntentId =
        typeof intent === "string" ? intent : (intent?.id ?? null);
      if (paymentIntentId) {
        return syncRefunds(deps, paymentIntentId, { event: ref });
      }
      break;
    }
  }
  // Not an event HeavyCards acts on (or not about a payment): acknowledge
  // and remember it, so a redelivery is skipped.
  const duplicate = await recordEventOnly(deps.db, ref);
  return { outcome: "no_change", orderId: null, productSlugs: [], duplicate };
}

async function readLimitedText(
  request: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
