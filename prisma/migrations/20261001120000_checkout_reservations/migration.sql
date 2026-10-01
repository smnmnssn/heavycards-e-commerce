-- Milestone 8: checkout, pending orders and inventory reservations.
--
-- 1. Orders store the customer's full name in one column (customer_name),
--    because Stripe Checkout collects it as one value. Existing first/last
--    names are merged into it before the old columns are dropped, so no
--    historical name is lost. Names are never split again.
-- 2. checkout_attempt_id (idempotency key of the checkout attempt) and
--    checkout_expires_at (the Stripe Checkout Session's expiry) support
--    idempotent checkout creation and reservation expiry.
-- 3. rate_limit_buckets backs the checkout rate limit.

-- AlterTable: new columns first, so existing names can be copied over.
ALTER TABLE "orders"
ADD COLUMN     "checkout_attempt_id" UUID,
ADD COLUMN     "checkout_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "customer_name" VARCHAR(200);

-- Preserve historical names: "First Last", or whichever part exists.
-- concat_ws skips NULLs; an order with neither part keeps NULL.
UPDATE "orders"
SET "customer_name" = NULLIF(btrim(concat_ws(' ', btrim("first_name"), btrim("last_name"))), '')
WHERE "first_name" IS NOT NULL OR "last_name" IS NOT NULL;

-- The paid-details invariant referenced the old columns; it is recreated
-- below with customer_name.
ALTER TABLE "orders" DROP CONSTRAINT "orders_paid_details_check";

ALTER TABLE "orders" DROP COLUMN "first_name",
DROP COLUMN "last_name";

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(200) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_attempt_id_key" ON "orders"("checkout_attempt_id");

-- ===========================================================================
-- Hand-written additions: invariants that schema.prisma cannot express.
-- Prisma ignores CHECK constraints when diffing. Keep in sync with
-- docs/database.md.
-- ===========================================================================

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customer_name_not_blank_check"
    CHECK ("customer_name" IS NULL OR btrim("customer_name") <> ''),
  -- A paid (or later refunded) order must have a payment time and the
  -- customer/shipping details collected by Stripe Checkout. Pending,
  -- expired and failed orders may lack them.
  ADD CONSTRAINT "orders_paid_details_check" CHECK (
    "payment_status" NOT IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
    OR (
      "paid_at" IS NOT NULL
      AND "email" IS NOT NULL
      AND "customer_name" IS NOT NULL
      AND "address_line1" IS NOT NULL
      AND "postal_code" IS NOT NULL
      AND "city" IS NOT NULL
    )
  );

ALTER TABLE "rate_limit_buckets"
  ADD CONSTRAINT "rate_limit_buckets_count_check" CHECK ("count" > 0);
