import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Tidies provisional holds of checkouts that never reached a payment page
 * (crashed or failed requests). Expired provisional reservations already
 * hold no stock (src/server/domain/inventory.ts), so this only sets their
 * status to RELEASED; correctness never depends on it running.
 *
 * Reservations awaiting payment are never touched here: Stripe may have
 * accepted the payment. They are resolved by webhooks or by
 * reconcileCheckouts (src/server/payments/reconcile.ts).
 *
 * Bounded per call and skips rows another transaction holds, so it can run
 * after any request without blocking checkouts. Order payment states are
 * left to payment processing.
 */
export async function releaseExpiredReservations(
  db: PrismaClient,
  now: Date,
  limit = 200,
): Promise<number> {
  return db.$executeRaw`
    UPDATE inventory_reservations
    SET status = 'RELEASED', updated_at = ${now}
    WHERE id IN (
      SELECT id FROM inventory_reservations
      WHERE status = 'ACTIVE' AND NOT awaiting_payment AND expires_at <= ${now}
      ORDER BY expires_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )`;
}
