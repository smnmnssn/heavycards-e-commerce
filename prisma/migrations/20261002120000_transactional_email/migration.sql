-- Milestone 10: transactional email outbox.
--
-- One row is the obligation to send one customer email about one order. It
-- is inserted in the same transaction as the business change (order paid,
-- order shipped) and delivered afterwards, outside any transaction, by
-- src/server/email/outbox.ts. No message content or recipient is stored:
-- both are rendered from the order when sending.
--
-- No rows are backfilled here. Orders that became paid before this
-- milestone and still have no confirmation are picked up by the scheduled
-- sweep (enqueueMissingOrderConfirmations), which can be re-run safely.

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('ORDER_CONFIRMATION', 'ORDER_SHIPPED');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_attempt_at" TIMESTAMPTZ(3),
    "outcome_unknown_since" TIMESTAMPTZ(3),
    "last_error" VARCHAR(100),
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_deliveries_status_next_attempt_at_idx" ON "email_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_order_id_kind_key" ON "email_deliveries"("order_id", "kind");

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot express.
ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_attempts_check" CHECK ("attempts" >= 0),
  -- SENT exactly when the provider accepted the email.
  ADD CONSTRAINT "email_deliveries_sent_check"
    CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
  -- Only a pending delivery can be leased by a dispatcher.
  ADD CONSTRAINT "email_deliveries_lock_check"
    CHECK ("status" = 'PENDING' OR "locked_until" IS NULL),
  ADD CONSTRAINT "email_deliveries_provider_id_check"
    CHECK ("provider_message_id" IS NULL OR "status" = 'SENT');
