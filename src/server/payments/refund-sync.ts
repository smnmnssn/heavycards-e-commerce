import { Prisma, type PaymentStatus } from "@/generated/prisma/client";
import {
  isUniqueViolation,
  withTransactionRetry,
} from "@/server/db/transactions";
import {
  canTransitionPayment,
  isPaidState,
  refundState,
} from "@/server/domain/payment";

import { logPayment } from "./log";
import {
  audit,
  insertEvent,
  PAYMENT_AUDIT_ACTIONS,
  recordEventOnly,
  syncCheckoutSession,
  type PaymentDeps,
  type StripeEventRef,
  type SyncResult,
} from "./session-sync";

/*
 * Refunds are made in the Stripe Dashboard (PROJECT.md §34). Any refund
 * event makes HeavyCards re-read the payment's refunds from Stripe and store
 * the total, so replayed, late or reordered events all converge on Stripe's
 * current figure:
 *
 *   refundedAmount = Σ refunds Stripe reports as succeeded
 *   0 → PAID, everything → REFUNDED, in between → PARTIALLY_REFUNDED
 *
 * A pending or requires_action refund changes nothing until a later event
 * reports it succeeded; if it fails or is cancelled instead, the order was
 * never touched. Refunds never change
 * inventory: restocking a returned item is a deliberate staff decision
 * (PROJECT.md §35).
 */

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export async function syncRefunds(
  deps: PaymentDeps,
  paymentIntentId: string,
  context: { event: StripeEventRef },
): Promise<SyncResult> {
  const findOrder = () =>
    deps.db.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: {
        id: true,
        paymentStatus: true,
        stripeCheckoutSessionId: true,
      },
    });

  let order = await findOrder();
  if (!order || order.paymentStatus === "PENDING") {
    // A refund proves the payment happened; if its own event has not been
    // processed yet, apply the session first (the same finalization).
    const sessionId =
      order?.stripeCheckoutSessionId ??
      (await deps.gateway.findCheckoutSessionIdForPayment(paymentIntentId));
    if (sessionId) {
      await syncCheckoutSession(deps, sessionId, { source: "webhook" });
      order = await findOrder();
    }
  }
  if (!order) {
    const duplicate = await recordEventOnly(deps.db, context.event);
    return {
      outcome: "unknown_session",
      orderId: null,
      productSlugs: [],
      duplicate,
    };
  }

  const refund = await deps.gateway.retrieveRefundedAmount(paymentIntentId);
  const orderId = order.id;

  try {
    return await withTransactionRetry(() =>
      deps.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '5s'`);
        const [locked] = await tx.$queryRaw<
          Array<{
            paymentStatus: PaymentStatus;
            totalAmount: number;
            refundedAmount: number;
          }>
        >`
          SELECT payment_status::text AS "paymentStatus",
                 total_amount AS "totalAmount",
                 refunded_amount AS "refundedAmount"
          FROM orders WHERE id = ${orderId}::uuid
          FOR UPDATE`;
        const result = await applyRefund(tx, orderId, locked!, refund, context);
        await insertEvent(tx, context.event);
        return result;
      }, TRANSACTION_OPTIONS),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        outcome: "no_change",
        orderId,
        productSlugs: [],
        duplicate: true,
      };
    }
    throw error;
  }
}

async function applyRefund(
  tx: Prisma.TransactionClient,
  orderId: string,
  order: {
    paymentStatus: PaymentStatus;
    totalAmount: number;
    refundedAmount: number;
  },
  refund: { amountRefunded: number; currency: string },
  context: { event: StripeEventRef },
): Promise<SyncResult> {
  const unchanged: SyncResult = {
    outcome: "no_change",
    orderId,
    productSlugs: [],
  };
  if (!isPaidState(order.paymentStatus)) {
    // Not paid in HeavyCards (e.g. the payment needs attention): nothing to
    // refund here; staff see the order's audit trail.
    logPayment("error", "refund for an unpaid order", {
      orderId,
      eventId: context.event.id,
    });
    return unchanged;
  }
  if (refund.amountRefunded > 0 && refund.currency !== "sek") {
    logPayment("error", "refund currency mismatch", {
      orderId,
      eventId: context.event.id,
    });
    return unchanged;
  }

  // Stripe never refunds more than was charged, and the charge equals the
  // order total (verified at payment). The cap only guards the invariant.
  const refundedAmount = Math.min(
    Math.max(0, refund.amountRefunded),
    order.totalAmount,
  );
  const status = refundState(order.totalAmount, refundedAmount);
  if (
    refundedAmount === order.refundedAmount &&
    status === order.paymentStatus
  ) {
    return unchanged;
  }
  if (!canTransitionPayment(order.paymentStatus, status)) {
    return unchanged;
  }

  await tx.order.update({
    where: { id: orderId },
    data: { refundedAmount, paymentStatus: status },
  });
  await audit(tx, PAYMENT_AUDIT_ACTIONS.refund, orderId, {
    from: order.paymentStatus,
    to: status,
    refundedAmount,
    previousRefundedAmount: order.refundedAmount,
    stripeEventId: context.event.id,
    stripeEventType: context.event.type,
  });
  return { outcome: "refund_synced", orderId, productSlugs: [] };
}
