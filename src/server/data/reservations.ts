import { Prisma } from "@/generated/prisma/client";

/*
 * The "reservation holds stock" rule from src/server/domain/inventory.ts,
 * once for raw SQL and once for Prisma filters. Every availability query uses
 * one of these, so the storefront, cart, checkout and admin always agree.
 */

/** For raw SQL where `inventory_reservations` is aliased as `r`. */
export function holdingReservationSql(now: Date): Prisma.Sql {
  return Prisma.sql`r.status = 'ACTIVE' AND (r.awaiting_payment OR r.expires_at > ${now})`;
}

export function holdingReservationWhere(
  now: Date,
): Prisma.InventoryReservationWhereInput {
  return {
    status: "ACTIVE",
    OR: [{ awaitingPayment: true }, { expiresAt: { gt: now } }],
  };
}

/** Fields `availableToSell` and `isReservationHolding` need. */
export const holdingReservationSelect = {
  quantity: true,
  status: true,
  expiresAt: true,
  awaitingPayment: true,
} satisfies Prisma.InventoryReservationSelect;
