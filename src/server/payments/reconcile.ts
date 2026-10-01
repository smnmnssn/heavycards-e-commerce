import { logPayment } from "./log";
import {
  syncCheckoutSession,
  type PaymentDeps,
  type SyncOutcome,
} from "./session-sync";

/*
 * Reconciliation for missed or delayed Stripe events (PROJECT.md §33).
 *
 * A reservation attached to a Stripe session ("awaiting payment") holds stock
 * until Stripe's outcome is applied, never just until a timestamp. Its
 * expiresAt (session expiry plus a grace period) is the moment a webhook
 * should have resolved it. Once that has passed, this asks Stripe for the
 * session's current state and applies it through the same
 * `syncCheckoutSession` the webhook uses:
 *
 * - paid → the order is finalized (the payment's webhook was late or lost);
 * - expired / failed → stock is released;
 * - still processing, still open, Stripe unreachable, or a disagreement that
 *   needs staff → nothing is released; the check is postponed by
 *   RECHECK_AFTER_MS (so a stuck order never starves the others).
 *
 * Inventory correctness wins over freeing stock early: units are only freed
 * on Stripe's word. A missed webhook therefore delays, but never prevents,
 * the release.
 *
 * Callers: GET /api/cron/reconcile-checkouts (Vercel Cron, protected by
 * CRON_SECRET) and a small batch after each checkout request. Runs may
 * overlap or repeat; every step is idempotent under the order row lock.
 */

export const RECHECK_AFTER_MS = 15 * 60 * 1000;

export type ReconcileSummary = {
  checked: number;
  outcomes: Partial<Record<SyncOutcome | "error", number>>;
  productSlugs: string[];
};

export async function reconcileCheckouts(
  deps: PaymentDeps,
  { limit = 25 }: { limit?: number } = {},
): Promise<ReconcileSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await deps.db.$queryRaw<
    Array<{ orderId: string; sessionId: string }>
  >`
    SELECT o.id::text AS "orderId", o.stripe_checkout_session_id AS "sessionId"
    FROM orders o
    JOIN inventory_reservations r ON r.order_id = o.id
    WHERE o.payment_status = 'PENDING'
      AND o.stripe_checkout_session_id IS NOT NULL
      AND r.status = 'ACTIVE'
      AND r.awaiting_payment
      AND r.expires_at <= ${now}
    GROUP BY o.id
    ORDER BY min(r.expires_at)
    LIMIT ${limit}`;

  const summary: ReconcileSummary = {
    checked: 0,
    outcomes: {},
    productSlugs: [],
  };
  for (const { orderId, sessionId } of due) {
    summary.checked += 1;
    let outcome: SyncOutcome | "error";
    try {
      const result = await syncCheckoutSession(deps, sessionId, {
        source: "reconciliation",
      });
      outcome = result.outcome;
      summary.productSlugs.push(...result.productSlugs);
    } catch (error) {
      // Stripe (or the database) unavailable: keep everything reserved and
      // try again later.
      outcome = "error";
      logPayment("error", "reconciliation could not reach a decision", {
        orderId,
        error,
      });
    }
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
    if (!RESOLVED.has(outcome)) {
      await postpone(deps, orderId, new Date(now.getTime() + RECHECK_AFTER_MS));
    }
  }
  summary.productSlugs = [...new Set(summary.productSlugs)];
  if (summary.checked > 0) {
    logPayment("info", "reconciliation run", {
      checked: summary.checked,
      ...summary.outcomes,
    });
  }
  return summary;
}

/** Outcomes that end the hold; anything else is checked again later. */
const RESOLVED = new Set<SyncOutcome | "error">(["paid", "expired", "failed"]);

/** Moves the next check of an unresolved order; the hold is unaffected. */
async function postpone(deps: PaymentDeps, orderId: string, next: Date) {
  try {
    await deps.db.inventoryReservation.updateMany({
      where: { orderId, status: "ACTIVE", awaitingPayment: true },
      data: { expiresAt: next },
    });
  } catch (error) {
    logPayment("error", "could not postpone reconciliation", {
      orderId,
      error,
    });
  }
}
