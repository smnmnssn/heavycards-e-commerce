import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { lockActiveAdmin } from "@/server/admin/access";
import { ATTENTION_ACTIONS } from "@/server/admin/orders/presenters";
import type { CheckoutGateway } from "@/server/checkout/gateway";
import { holdingReservationSql } from "@/server/data/reservations";
import { withTransactionRetry } from "@/server/db/transactions";
import {
  classifySession,
  type CheckoutSessionState,
} from "@/server/domain/payment";
import { FIRST_ORDER_NUMBER } from "@/server/domain/order-number";
import { releaseReservations } from "@/server/payments/session-sync";

/*
 * Operator procedure for a checkout whose stock stays reserved because
 * Stripe reports a state HeavyCards cannot accept (Milestone 12's
 * "remaining limit"): e.g. Stripe charged an amount that differs from the
 * order, or a paid session lacks the delivery address. Payment truth
 * still decides. The hold is released only when Stripe itself shows that
 * the customer's money was returned in full (succeeded refunds covering
 * the charged amount) or was never taken (the PaymentIntent was
 * canceled). Then:
 *
 * - the order's reservations are RELEASED and the order becomes FAILED
 *   (it was never accepted as paid; FAILED is final, so later events
 *   cannot revive it);
 * - the PaymentIntent ID is stored, so later refund events find the order
 *   (and leave it alone: it is not paid);
 * - an OPERATOR_RELEASE_PAYMENT_HOLD audit entry names the OWNER who ran
 *   it and the Stripe evidence.
 *
 * Every other state is refused with the reason: a session that can still
 * be paid or is processing, one that expired or failed (the normal
 * "Kontrollera med Stripe igen" handles that), a payment not (fully)
 * refunded, or an order without an open payment problem. There is no
 * admin button for this; it runs from `npm run ops` (scripts/operator.ts),
 * which authenticates the OWNER and asks for explicit confirmation.
 */

export const RELEASE_HOLD_AUDIT_ACTION = "OPERATOR_RELEASE_PAYMENT_HOLD";

const LOCK_TIMEOUT = Prisma.sql`SET LOCAL lock_timeout = '5s'`;

export type HoldEvidence =
  | { kind: "payment_canceled"; paymentIntentId: string }
  | {
      kind: "refunded";
      paymentIntentId: string;
      chargedAmount: number;
      refundedAmount: number;
    };

export type HoldAssessment =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      heldUnits: number;
      problems: string[];
      evidence: HoldEvidence;
    }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        /** Not a pending checkout that holds stock. */
        | "NOT_HOLDING"
        /** No open PAYMENT_NEEDS_ATTENTION entry: the normal flow applies. */
        | "NOT_FLAGGED"
        /** The customer can still pay, or the payment is still processing. */
        | "STILL_PAYABLE"
        /** Expired or failed at Stripe: use "Kontrollera med Stripe igen". */
        | "USE_RECHECK"
        /** Stripe kept money that has not been fully refunded. */
        | "NOT_REFUNDED"
        /** Stripe's state does not prove anything either way. */
        | "UNVERIFIABLE";
      detail?: string;
    };

export type ReleaseHoldResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      evidence: HoldEvidence;
      productSlugs: string[];
    }
  | Extract<HoldAssessment, { ok: false }>
  | { ok: false; error: "CHANGED" };

type Deps = { db: PrismaClient; gateway: CheckoutGateway; now?: () => Date };

/**
 * Checks, without changing anything, whether the order's hold may be
 * released, and on what evidence. The operator script shows this before
 * asking for confirmation; `releasePaymentHold` repeats it.
 */
export async function assessPaymentHold(
  deps: Deps,
  orderNumber: number,
): Promise<HoldAssessment> {
  const now = (deps.now ?? (() => new Date()))();
  const order = await deps.db.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      paymentStatus: true,
      stripeCheckoutSessionId: true,
    },
  });
  if (!order) return { ok: false, error: "NOT_FOUND" };
  const heldUnits = await heldUnitsOf(deps.db, order.id, now);
  if (
    order.paymentStatus !== "PENDING" ||
    !order.stripeCheckoutSessionId ||
    heldUnits === 0
  ) {
    return { ok: false, error: "NOT_HOLDING" };
  }
  const problems = await openPaymentProblems(deps.db, order.id);
  if (problems.length === 0) return { ok: false, error: "NOT_FLAGGED" };

  const state = await deps.gateway.retrieveCheckoutSession(
    order.stripeCheckoutSessionId,
  );
  if (state.id !== order.stripeCheckoutSessionId) {
    return { ok: false, error: "UNVERIFIABLE", detail: "session_mismatch" };
  }
  const evidence = await moneyReturnedEvidence(deps.gateway, state);
  if (!evidence.ok) return evidence;
  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    heldUnits,
    problems,
    evidence: evidence.evidence,
  };
}

async function moneyReturnedEvidence(
  gateway: CheckoutGateway,
  state: CheckoutSessionState,
): Promise<
  { ok: true; evidence: HoldEvidence } | Extract<HoldAssessment, { ok: false }>
> {
  switch (classifySession(state)) {
    case "open":
    case "processing":
      return { ok: false, error: "STILL_PAYABLE" };
    case "expired":
    case "failed":
      return { ok: false, error: "USE_RECHECK" };
    case "paid":
    case "unknown":
      break;
  }
  const intent = state.paymentIntent;
  if (!intent) {
    return { ok: false, error: "UNVERIFIABLE", detail: "no_payment_intent" };
  }
  if (intent.status === "canceled") {
    return {
      ok: true,
      evidence: { kind: "payment_canceled", paymentIntentId: intent.id },
    };
  }
  if (state.amountTotal === null || state.currency === null) {
    return { ok: false, error: "UNVERIFIABLE", detail: "no_charged_amount" };
  }
  const refund = await gateway.retrieveRefundedAmount(intent.id);
  if (
    refund.amountRefunded < state.amountTotal ||
    refund.currency !== state.currency
  ) {
    return {
      ok: false,
      error: "NOT_REFUNDED",
      detail: `refunded ${refund.amountRefunded} of ${state.amountTotal} ${state.currency}`,
    };
  }
  return {
    ok: true,
    evidence: {
      kind: "refunded",
      paymentIntentId: intent.id,
      chargedAmount: state.amountTotal,
      refundedAmount: refund.amountRefunded,
    },
  };
}

/**
 * Releases the hold of an order whose Stripe payment was returned in full
 * or never taken (see the module comment). `actorId` must be an active
 * OWNER; `note` is a short operator note for the audit log and must not
 * contain customer data.
 */
export async function releasePaymentHold(
  deps: Deps,
  {
    actorId,
    orderNumber,
    note,
  }: { actorId: string; orderNumber: number; note: string },
): Promise<ReleaseHoldResult> {
  const assessment = await assessPaymentHold(deps, orderNumber);
  if (!assessment.ok) return assessment;
  const { orderId, evidence, problems } = assessment;

  return withTransactionRetry(() =>
    deps.db.$transaction(async (tx) => {
      await tx.$executeRaw(LOCK_TIMEOUT);
      await lockActiveAdmin(
        tx,
        actorId,
        (admin) => admin.role === "OWNER",
        "Endast en aktiv ägare (OWNER) kan släppa en reservation.",
      );
      const [locked] = await tx.$queryRaw<
        Array<{ paymentStatus: string; paymentIntentId: string | null }>
      >`
        SELECT payment_status::text AS "paymentStatus",
               stripe_payment_intent_id AS "paymentIntentId"
        FROM orders WHERE id = ${orderId}::uuid
        FOR UPDATE`;
      // A webhook or reconciliation may have resolved it since the check.
      if (locked?.paymentStatus !== "PENDING") {
        return { ok: false, error: "CHANGED" } as const;
      }
      const productSlugs = await releaseReservations(tx, orderId);
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "FAILED",
          checkoutClientKey: null,
          stripePaymentIntentId:
            locked.paymentIntentId ?? evidence.paymentIntentId,
        },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: actorId,
          action: RELEASE_HOLD_AUDIT_ACTION,
          entityType: "Order",
          entityId: orderId,
          metadata: {
            problems,
            evidence: evidence.kind,
            ...(evidence.kind === "refunded" && {
              chargedAmount: evidence.chargedAmount,
              refundedAmount: evidence.refundedAmount,
            }),
            note: note.trim().slice(0, 200),
          },
        },
      });
      return {
        ok: true,
        orderId,
        orderNumber,
        evidence,
        productSlugs: [...new Set(productSlugs)],
      } as const;
    }),
  );
}

async function heldUnitsOf(db: PrismaClient, orderId: string, now: Date) {
  const [row] = await db.$queryRaw<Array<{ units: number }>>`
    SELECT coalesce(sum(r.quantity), 0)::int AS units
    FROM inventory_reservations r
    WHERE r.order_id = ${orderId}::uuid AND ${holdingReservationSql(now)}`;
  return row?.units ?? 0;
}

/** Problem codes of the order's PAYMENT_NEEDS_ATTENTION entries. */
async function openPaymentProblems(db: PrismaClient, orderId: string) {
  const entries = await db.auditLog.findMany({
    where: {
      action: ATTENTION_ACTIONS.payment,
      entityType: "Order",
      entityId: orderId,
    },
    select: { metadata: true },
  });
  return entries.map((entry) => {
    const problem =
      entry.metadata && typeof entry.metadata === "object"
        ? (entry.metadata as Record<string, unknown>).problem
        : null;
    return typeof problem === "string" ? problem : "unknown";
  });
}

/** "HC-10001", "hc10001" or "10001" → 10001; null otherwise. */
export function parseOrderNumber(value: string): number | null {
  const match = /^\s*(?:hc-?)?(\d{1,9})\s*$/i.exec(value);
  const number = match ? Number(match[1]) : null;
  return number !== null && number >= FIRST_ORDER_NUMBER ? number : null;
}
