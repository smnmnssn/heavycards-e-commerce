import {
  Prisma,
  type PaymentStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { CheckoutGateway } from "@/server/checkout/gateway";
import {
  isUniqueViolation,
  withTransactionRetry,
} from "@/server/db/transactions";
import {
  amountMismatch,
  canTransitionPayment,
  classifySession,
  fulfillmentDetails,
  isPaidState,
  type CheckoutSessionState,
} from "@/server/domain/payment";
import { enqueueOrderEmail } from "@/server/email/outbox";

import { logPayment } from "./log";

/*
 * Applies a Stripe Checkout Session's authoritative state to its HeavyCards
 * order. This is the single implementation of payment finalization: Stripe
 * webhooks and reconciliation both call `syncCheckoutSession`, which reads
 * the session from Stripe's API (never from an event payload or the
 * browser) and then, in one transaction with the order row locked:
 *
 * - paid → verifies amount and currency, validates the customer details,
 *   decrements stock by the reserved quantities, marks the reservations
 *   CONSUMED and the order PAID, and records the order-confirmation email
 *   obligation (sent after the commit by src/server/email), exactly once;
 * - expired → releases the reservations and marks the order EXPIRED;
 * - failed (delayed payment failed) → releases and marks it FAILED;
 * - processing / open → only records the payment's ID.
 *
 * Exactly once: every change requires the order to be PENDING (locked FOR
 * UPDATE) and the reservations to be ACTIVE, and moves both out of those
 * states in the same transaction. A duplicate, concurrent or late event, or
 * reconciliation running at the same time, finds the order already moved on
 * and changes nothing. Because the *current* session state is applied, the
 * order in which events arrive does not matter.
 */

export type PaymentSource = "webhook" | "reconciliation";
export type StripeEventRef = { id: string; type: string };

export type PaymentDeps = {
  db: PrismaClient;
  gateway: CheckoutGateway;
  now?: () => Date;
};

export type SyncOutcome =
  | "paid"
  | "expired"
  | "failed"
  /** A delayed payment has not settled yet: stock stays reserved. */
  | "processing"
  /** The session can still be paid: nothing to do yet. */
  | "open"
  /** The order already reflects this (duplicate or late event). */
  | "no_change"
  /** Not a HeavyCards checkout (or not one we know). */
  | "unknown_session"
  /** Stripe and HeavyCards disagree; nothing changed, staff must look. */
  | "needs_attention"
  /** Refund state synchronized (src/server/payments/refund-sync.ts). */
  | "refund_synced";

export type SyncResult = {
  outcome: SyncOutcome;
  orderId: string | null;
  /** Products whose availability changed: their pages need revalidation. */
  productSlugs: string[];
  /** The event had already been processed (duplicate delivery). */
  duplicate?: boolean;
};

export const PAYMENT_AUDIT_ACTIONS = {
  paid: "MARK_ORDER_PAID",
  failed: "MARK_ORDER_PAYMENT_FAILED",
  refund: "SYNC_ORDER_REFUND",
  attention: "PAYMENT_NEEDS_ATTENTION",
} as const;

const LOCK_TIMEOUT = Prisma.sql`SET LOCAL lock_timeout = '5s'`;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

type Tx = Prisma.TransactionClient;

/**
 * Reads the session from Stripe and applies it. Throws when Stripe or the
 * database is unavailable; the caller then answers Stripe with an error (it
 * retries) or tries again in the next reconciliation run. Nothing is
 * released in that case, so stock stays protected.
 */
export async function syncCheckoutSession(
  deps: PaymentDeps,
  sessionId: string,
  context: { source: PaymentSource; event?: StripeEventRef },
): Promise<SyncResult> {
  const known = await deps.db.order.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
    select: { id: true },
  });
  if (!known) {
    // Not ours (another integration, or a test session): never ask Stripe
    // on behalf of unknown IDs.
    const duplicate = context.event
      ? await recordEventOnly(deps.db, context.event)
      : false;
    return {
      outcome: "unknown_session",
      orderId: null,
      productSlugs: [],
      duplicate,
    };
  }

  const state = await deps.gateway.retrieveCheckoutSession(sessionId);
  if (state.id !== sessionId) {
    throw new Error("Stripe returned a different Checkout Session");
  }
  const now = (deps.now ?? (() => new Date()))();
  return applySessionState(deps.db, state, { ...context, now });
}

async function applySessionState(
  db: PrismaClient,
  state: CheckoutSessionState,
  context: { source: PaymentSource; event?: StripeEventRef; now: Date },
): Promise<SyncResult> {
  try {
    return await withTransactionRetry(() =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw(LOCK_TIMEOUT);
        const result = await applyLocked(tx, state, context);
        if (context.event) await insertEvent(tx, context.event);
        return result;
      }, TRANSACTION_OPTIONS),
    );
  } catch (error) {
    // The same event, delivered twice at once: the other delivery committed
    // first (with identical effects); this one rolled back entirely.
    if (context.event && isUniqueViolation(error)) {
      return {
        outcome: "no_change",
        orderId: null,
        productSlugs: [],
        duplicate: true,
      };
    }
    throw error;
  }
}

type LockedOrder = {
  id: string;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  currency: "SEK";
  paymentIntentId: string | null;
};

async function applyLocked(
  tx: Tx,
  state: CheckoutSessionState,
  context: { source: PaymentSource; event?: StripeEventRef; now: Date },
): Promise<SyncResult> {
  const [order] = await tx.$queryRaw<LockedOrder[]>`
    SELECT id::text AS id,
           payment_status::text AS "paymentStatus",
           total_amount AS "totalAmount",
           currency::text AS currency,
           stripe_payment_intent_id AS "paymentIntentId"
    FROM orders
    WHERE stripe_checkout_session_id = ${state.id}
    FOR UPDATE`;
  if (!order) {
    return { outcome: "unknown_session", orderId: null, productSlugs: [] };
  }

  const unchanged: SyncResult = {
    outcome: "no_change",
    orderId: order.id,
    productSlugs: [],
  };

  switch (classifySession(state)) {
    case "paid":
      if (isPaidState(order.paymentStatus)) return unchanged;
      if (order.paymentStatus !== "PENDING") {
        // Stripe took a payment for a checkout HeavyCards already closed.
        // The design prevents this (a session is only released after Stripe
        // reports it expired or failed); if it ever happens, a person must
        // decide between shipping and refunding.
        return needsAttention(tx, order, "paid_after_close", context);
      }
      return finalizePaid(tx, order, state, context);

    case "expired":
      return releaseOrder(tx, order, "EXPIRED", context);

    case "failed":
      return releaseOrder(tx, order, "FAILED", context);

    case "processing":
      if (
        order.paymentStatus === "PENDING" &&
        state.paymentIntent &&
        order.paymentIntentId !== state.paymentIntent.id
      ) {
        await tx.order.update({
          where: { id: order.id },
          data: { stripePaymentIntentId: state.paymentIntent.id },
        });
      }
      return { ...unchanged, outcome: "processing" };

    case "open":
      return { ...unchanged, outcome: "open" };

    case "unknown":
      // Only a pending order is waiting for an answer; a paid or closed one
      // is never changed by an unexpected session state.
      return order.paymentStatus === "PENDING"
        ? needsAttention(tx, order, "unexpected_session_state", context)
        : unchanged;
  }
}

async function finalizePaid(
  tx: Tx,
  order: LockedOrder,
  state: CheckoutSessionState,
  context: { source: PaymentSource; event?: StripeEventRef; now: Date },
): Promise<SyncResult> {
  const mismatch = amountMismatch(state, order);
  if (mismatch) {
    return needsAttention(tx, order, `${mismatch}_mismatch`, context);
  }
  const details = fulfillmentDetails(state);
  if (!details.ok) {
    return needsAttention(tx, order, "missing_customer_data", context, {
      fields: details.problems,
    });
  }
  if (!state.paymentIntent) {
    return needsAttention(tx, order, "missing_payment", context);
  }

  const reservations = await tx.inventoryReservation.findMany({
    where: { orderId: order.id },
    select: { productId: true, quantity: true, status: true },
  });
  if (
    reservations.length === 0 ||
    reservations.some((reservation) => reservation.status !== "ACTIVE")
  ) {
    return needsAttention(tx, order, "reservations_not_active", context);
  }

  // Same lock order as checkout (by product id): no deadlocks.
  const productIds = reservations.map((r) => r.productId).sort();
  const products = await tx.$queryRaw<
    Array<{ id: string; slug: string; stockOnHand: number }>
  >`
    SELECT id::text AS id, slug, stock_on_hand AS "stockOnHand"
    FROM products
    WHERE id = ANY(${productIds}::uuid[])
    ORDER BY id
    FOR UPDATE`;
  const byId = new Map(products.map((product) => [product.id, product]));

  // The reserved quantity is what this payment bought; it is subtracted
  // exactly once, here, together with consuming the reservation.
  const shortfalls: Array<{ productId: string; missing: number }> = [];
  for (const reservation of reservations) {
    const product = byId.get(reservation.productId)!;
    const missing = Math.max(0, reservation.quantity - product.stockOnHand);
    if (missing > 0) {
      // Stock was lowered below the reserved quantity (e.g. an admin
      // correction). The payment is real, so the order is still paid; the
      // gap is recorded for staff.
      shortfalls.push({ productId: product.id, missing });
    }
    await tx.product.update({
      where: { id: product.id },
      data: {
        stockOnHand: Math.max(0, product.stockOnHand - reservation.quantity),
      },
    });
  }
  const consumed = await tx.inventoryReservation.updateMany({
    where: { orderId: order.id, status: "ACTIVE" },
    data: { status: "CONSUMED" },
  });
  if (consumed.count !== reservations.length) {
    throw new Error("Reservations changed during payment finalization");
  }

  const { details: customer } = details;
  await tx.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PAID",
      paidAt: state.paymentIntent.paidAt ?? context.now,
      stripePaymentIntentId: state.paymentIntent.id,
      // The open-hold cap only concerns unpaid checkouts.
      checkoutClientKey: null,
      customerName: customer.customerName,
      email: customer.email,
      phone: customer.phone,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.country,
      // fulfillmentStatus stays NEW: staff start handling paid orders.
    },
  });
  await audit(tx, PAYMENT_AUDIT_ACTIONS.paid, order.id, {
    ...sourceMetadata(context),
    ...(shortfalls.length > 0 && { stockShortfalls: shortfalls }),
  });
  // The confirmation becomes due together with the payment, atomically: if
  // this transaction rolls back, no email is owed; if it commits, the
  // outbox delivers it later, outside this transaction.
  await enqueueOrderEmail(tx, order.id, "ORDER_CONFIRMATION", context.now);
  if (shortfalls.length > 0) {
    logPayment("error", "stock below reserved quantity at payment", {
      orderId: order.id,
      eventId: context.event?.id,
    });
  }

  return {
    outcome: "paid",
    orderId: order.id,
    productSlugs: products.map((product) => product.slug),
  };
}

/**
 * Releases a pending order's reservations because Stripe reported its
 * session expired or its delayed payment failed. Never touches an order
 * that is paid (a late expiry event) or already closed.
 */
async function releaseOrder(
  tx: Tx,
  order: LockedOrder,
  status: "EXPIRED" | "FAILED",
  context: { source: PaymentSource; event?: StripeEventRef },
): Promise<SyncResult> {
  if (
    order.paymentStatus !== "PENDING" ||
    !canTransitionPayment(order.paymentStatus, status)
  ) {
    return { outcome: "no_change", orderId: order.id, productSlugs: [] };
  }
  const released = await releaseReservations(tx, order.id);
  await tx.order.update({
    where: { id: order.id },
    data: { paymentStatus: status, checkoutClientKey: null },
  });
  if (status === "FAILED") {
    await audit(
      tx,
      PAYMENT_AUDIT_ACTIONS.failed,
      order.id,
      sourceMetadata(context),
    );
  }
  return {
    outcome: status === "FAILED" ? "failed" : "expired",
    orderId: order.id,
    productSlugs: released,
  };
}

/** Releases all ACTIVE reservations of an order; returns product slugs. */
export async function releaseReservations(
  tx: Tx,
  orderId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ slug: string }>>`
    UPDATE inventory_reservations r
    SET status = 'RELEASED', updated_at = now()
    FROM products p
    WHERE r.order_id = ${orderId}::uuid
      AND r.status = 'ACTIVE'
      AND p.id = r.product_id
    RETURNING p.slug`;
  return rows.map((row) => row.slug);
}

/**
 * Records a disagreement between Stripe and HeavyCards without changing the
 * order: it stays PENDING with its stock reserved (never oversold, never
 * malformed), and an audit entry (once per problem) tells staff. Retries and
 * reconciliation see the same state and change nothing.
 */
async function needsAttention(
  tx: Tx,
  order: LockedOrder,
  problem: string,
  context: { source: PaymentSource; event?: StripeEventRef },
  extra: Prisma.InputJsonObject = {},
): Promise<SyncResult> {
  logPayment("error", "payment needs attention", {
    orderId: order.id,
    eventId: context.event?.id,
    problem,
  });
  const existing = await tx.auditLog.findFirst({
    where: {
      action: PAYMENT_AUDIT_ACTIONS.attention,
      entityType: "Order",
      entityId: order.id,
      metadata: { path: ["problem"], equals: problem },
    },
    select: { id: true },
  });
  if (!existing) {
    await audit(tx, PAYMENT_AUDIT_ACTIONS.attention, order.id, {
      problem,
      ...extra,
      ...sourceMetadata(context),
    });
  }
  return { outcome: "needs_attention", orderId: order.id, productSlugs: [] };
}

function sourceMetadata(context: {
  source: PaymentSource;
  event?: StripeEventRef;
}): Prisma.InputJsonObject {
  return {
    source: context.source,
    ...(context.event && {
      stripeEventId: context.event.id,
      stripeEventType: context.event.type,
    }),
  };
}

/** System audit entry (no administrator). Never contains personal data. */
export async function audit(
  tx: Tx,
  action: (typeof PAYMENT_AUDIT_ACTIONS)[keyof typeof PAYMENT_AUDIT_ACTIONS],
  orderId: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      adminUserId: null,
      action,
      entityType: "Order",
      entityId: orderId,
      metadata,
    },
  });
}

export async function insertEvent(tx: Tx, event: StripeEventRef) {
  await tx.stripeEvent.create({
    data: { stripeEventId: event.id, type: event.type.slice(0, 100) },
  });
}

/** Records an event that changes nothing; false if it was already recorded. */
export async function recordEventOnly(
  db: PrismaClient,
  event: StripeEventRef,
): Promise<boolean> {
  try {
    await db.stripeEvent.create({
      data: { stripeEventId: event.id, type: event.type.slice(0, 100) },
    });
    return false;
  } catch (error) {
    if (isUniqueViolation(error)) return true;
    throw error;
  }
}
