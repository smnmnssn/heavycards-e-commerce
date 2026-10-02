import { z } from "zod";

import { canManageOrders } from "@/lib/auth/authorization";
import { logPayment } from "@/server/payments/log";
import {
  syncCheckoutSession,
  type PaymentDeps,
  type SyncOutcome,
} from "@/server/payments/session-sync";

import { assertActiveAdmin } from "../access";

/*
 * "Kontrollera med Stripe igen" for a pending order whose payment needs
 * attention. It asks Stripe for the Checkout Session's current state and
 * applies it through the one payment-finalization implementation
 * (`syncCheckoutSession`, Milestone 9), exactly as reconciliation does:
 *
 * - paid (and consistent) → finalized: stock consumed, order PAID,
 *   confirmation email obligation;
 * - expired / failed → the reservations are released, order EXPIRED/FAILED;
 * - still inconsistent, processing or open → nothing changes; the stock
 *   stays reserved and the problem stays visible;
 * - Stripe unreachable → nothing changes (UNAVAILABLE).
 *
 * The administrator's click never decides the outcome; only Stripe's
 * authoritative state does. Nothing here releases stock itself.
 */

export const PAYMENT_RECHECK_AUDIT_ACTION = "RECHECK_ORDER_PAYMENT";

const inputSchema = z.object({ orderId: z.uuid() });

export type PaymentRecheckResult =
  | { ok: true; orderId: string; outcome: SyncOutcome; productSlugs: string[] }
  | {
      ok: false;
      error: "INVALID_INPUT" | "NOT_FOUND" | "NOT_APPLICABLE" | "UNAVAILABLE";
    };

export async function recheckOrderPayment(
  deps: PaymentDeps,
  { actorId, input }: { actorId: string; input: unknown },
): Promise<PaymentRecheckResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { orderId } = parsed.data;
  // Checked before Stripe is contacted; the payment service takes its own
  // order lock, and its effects never depend on who asked.
  await assertActiveAdmin(
    deps.db,
    actorId,
    canManageOrders,
    "Behörighet saknas för beställningar.",
  );

  const order = await deps.db.order.findUnique({
    where: { id: orderId },
    select: { paymentStatus: true, stripeCheckoutSessionId: true },
  });
  if (!order) return { ok: false, error: "NOT_FOUND" };
  // Only a pending checkout waits for Stripe's answer.
  if (order.paymentStatus !== "PENDING" || !order.stripeCheckoutSessionId) {
    return { ok: false, error: "NOT_APPLICABLE" };
  }

  let outcome: SyncOutcome | "unavailable";
  let productSlugs: string[] = [];
  try {
    const result = await syncCheckoutSession(
      deps,
      order.stripeCheckoutSessionId,
      { source: "reconciliation" },
    );
    outcome = result.outcome;
    productSlugs = result.productSlugs;
  } catch (error) {
    // Stripe (or the database) unavailable: everything stays reserved.
    outcome = "unavailable";
    logPayment("error", "admin payment recheck could not reach a decision", {
      orderId,
      error,
    });
  }

  await deps.db.auditLog.create({
    data: {
      adminUserId: actorId,
      action: PAYMENT_RECHECK_AUDIT_ACTION,
      entityType: "Order",
      entityId: orderId,
      metadata: { outcome },
    },
  });
  if (outcome === "unavailable") return { ok: false, error: "UNAVAILABLE" };
  return { ok: true, orderId, outcome, productSlugs };
}
