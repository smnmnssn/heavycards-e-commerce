-- Milestone 11: verified-purchase review invitations.
--
-- A review_tokens row is the review invitation of one shipped order. It is
-- created in the same transaction that first marks the order SHIPPED, and
-- the shipping email renders its link. The raw token is never stored: it is
-- HMAC(server key, nonce), with the key derived from AUTH_SECRET, so every
-- email retry re-derives the identical URL while the database alone cannot
-- produce a working link (src/server/domain/review-token.ts).
--
-- No earlier code ever wrote review_tokens, so the table is empty and the
-- NOT NULL column needs no default. If rows did exist, this migration fails
-- instead of inventing values. Nothing is backfilled: orders shipped before
-- this milestone get no invitation and no email.

-- DropIndex
DROP INDEX "review_tokens_order_id_idx";

-- AlterTable
ALTER TABLE "review_tokens" ADD COLUMN     "nonce" CHAR(43) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "review_tokens_order_id_key" ON "review_tokens"("order_id");

-- Invariants Prisma cannot express.
ALTER TABLE "review_tokens"
  -- 256 random bits, base64url without padding.
  ADD CONSTRAINT "review_tokens_nonce_format_check" CHECK ("nonce" ~ '^[A-Za-z0-9_-]{43}$'),
  ADD CONSTRAINT "review_tokens_revoked_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");
