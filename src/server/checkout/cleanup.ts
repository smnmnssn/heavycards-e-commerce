import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Safety net for reservations whose checkout was never resolved (missed
 * webhook, crashed request). Expired ACTIVE reservations already hold no
 * stock (src/server/domain/inventory.ts), so this only tidies their status
 * to RELEASED; correctness never depends on it running.
 *
 * Bounded per call and skips rows another transaction holds, so it can run
 * after any request without blocking checkouts. Order payment states are
 * left to Stripe event processing (Milestone 9).
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
      WHERE status = 'ACTIVE' AND expires_at <= ${now}
      ORDER BY expires_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )`;
}
