-- Milestone 9: Stripe webhooks, order finalization and reconciliation.
--
-- A reservation attached to a Stripe Checkout Session the customer can pay
-- must hold stock until Stripe's outcome is known, not until a timestamp
-- passes: Stripe may accept a payment whose webhook arrives late. The new
-- flag marks those holds (see src/server/domain/inventory.ts).

-- AlterTable
ALTER TABLE "inventory_reservations" ADD COLUMN     "awaiting_payment" BOOLEAN NOT NULL DEFAULT false;

-- Reservations attached by Milestone 8 checkouts that are still pending
-- belong to payable sessions: they now wait for Stripe's outcome (applied by
-- webhooks or reconciliation) instead of lapsing by time.
UPDATE "inventory_reservations" AS r
SET "awaiting_payment" = true
FROM "orders" AS o
WHERE r."order_id" = o."id"
  AND r."status" = 'ACTIVE'
  AND o."payment_status" = 'PENDING'
  AND o."stripe_checkout_session_id" IS NOT NULL;
