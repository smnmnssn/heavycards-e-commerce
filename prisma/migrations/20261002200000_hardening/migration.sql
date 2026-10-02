-- Milestone 14: security and reliability hardening.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "checkout_client_key" VARCHAR(64);

-- CreateIndex
CREATE INDEX "orders_checkout_client_key_idx" ON "orders"("checkout_client_key");

-- ===========================================================================
-- Hand-written additions: invariants that schema.prisma cannot express.
-- Prisma ignores CHECK constraints when diffing. Keep in sync with
-- docs/database.md.
-- ===========================================================================

ALTER TABLE "orders"
  -- A pending checkout can still be paid at Stripe; it is never handled or
  -- cancelled before Stripe's outcome is known (a payment for a cancelled
  -- order would be taken without anything being shipped or flagged).
  ADD CONSTRAINT "orders_pending_unfulfilled_check"
    CHECK ("payment_status" <> 'PENDING' OR "fulfillment_status" = 'NEW'),
  -- Handling, shipping and completing require a payment HeavyCards accepted.
  ADD CONSTRAINT "orders_fulfillment_requires_payment_check" CHECK (
    "fulfillment_status" IN ('NEW', 'CANCELLED')
    OR "payment_status" IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
  ),
  -- The refund state always matches the refunded amount (Stripe's succeeded
  -- refunds, src/server/payments/refund-sync.ts); unpaid orders have none.
  ADD CONSTRAINT "orders_refunded_amount_state_check" CHECK (
    ("payment_status" = 'PARTIALLY_REFUNDED'
      AND "refunded_amount" > 0 AND "refunded_amount" < "total_amount")
    OR ("payment_status" = 'REFUNDED' AND "refunded_amount" = "total_amount")
    OR ("payment_status" NOT IN ('PARTIALLY_REFUNDED', 'REFUNDED')
      AND "refunded_amount" = 0)
  );
