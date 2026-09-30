-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SEALED', 'SINGLE', 'GRADED', 'ACCESSORY', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMING_SOON', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('SEK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('NEW', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShippingCarrier" AS ENUM ('POSTNORD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pokemon_sets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "release_date" DATE,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pokemon_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "short_description" VARCHAR(500),
    "description" TEXT,
    "product_type" "ProductType" NOT NULL DEFAULT 'SEALED',
    "price_amount" INTEGER NOT NULL,
    "compare_at_price_amount" INTEGER,
    "sku" VARCHAR(64) NOT NULL,
    "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "category_id" UUID NOT NULL,
    "pokemon_set_id" UUID,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_preorder" BOOLEAN NOT NULL DEFAULT false,
    "release_date" DATE,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(500),
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "alt_text" VARCHAR(300),
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" SERIAL NOT NULL,
    "email" VARCHAR(320),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "phone" VARCHAR(40),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "postal_code" VARCHAR(20),
    "city" VARCHAR(100),
    "country" CHAR(2) NOT NULL DEFAULT 'SE',
    "subtotal_amount" INTEGER NOT NULL,
    "shipping_amount" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'SEK',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'NEW',
    "paid_at" TIMESTAMPTZ(3),
    "stripe_checkout_session_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "shipping_carrier" "ShippingCarrier",
    "tracking_number" VARCHAR(100),
    "shipped_at" TIMESTAMPTZ(3),
    "confirmation_email_sent_at" TIMESTAMPTZ(3),
    "shipping_email_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name_snapshot" VARCHAR(200) NOT NULL,
    "sku_snapshot" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "total_price_amount" INTEGER NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" UUID NOT NULL,
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_item_id" UUID,
    "display_name" VARCHAR(60) NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(120),
    "body" TEXT NOT NULL,
    "verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tokens" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "review_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(100) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" UUID NOT NULL,
    "source_path" VARCHAR(500) NOT NULL,
    "destination_path" VARCHAR(500) NOT NULL,
    "permanent" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "store_name" VARCHAR(120) NOT NULL,
    "contact_email" VARCHAR(320) NOT NULL,
    "company_name" VARCHAR(200),
    "organization_number" VARCHAR(20),
    "shipping_price_amount" INTEGER NOT NULL,
    "free_shipping_threshold_amount" INTEGER,
    "default_shipping_carrier" "ShippingCarrier" NOT NULL DEFAULT 'POSTNORD',
    "vat_rate_basis_points" INTEGER NOT NULL DEFAULT 2500,
    "low_stock_threshold" INTEGER NOT NULL,
    "default_seo_title" VARCHAR(200),
    "default_seo_description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pokemon_sets_slug_key" ON "pokemon_sets"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "products"("status", "published_at");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_pokemon_set_id_idx" ON "products"("pokemon_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_checkout_session_id_key" ON "orders"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_key" ON "orders"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "orders_payment_status_fulfillment_status_idx" ON "orders"("payment_status", "fulfillment_status");

-- CreateIndex
CREATE INDEX "orders_paid_at_idx" ON "orders"("paid_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_email_idx" ON "orders"("email");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_product_id_status_idx" ON "inventory_reservations"("product_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_order_id_product_id_key" ON "inventory_reservations"("order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_events_stripe_event_id_key" ON "stripe_events"("stripe_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_idx" ON "reviews"("product_id", "status");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_tokens_token_hash_key" ON "review_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "review_tokens_order_id_idx" ON "review_tokens"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_admin_user_id_created_at_idx" ON "audit_logs"("admin_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_source_path_key" ON "redirects"("source_path");

-- CreateIndex
CREATE INDEX "redirects_destination_path_idx" ON "redirects"("destination_path");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_pokemon_set_id_fkey" FOREIGN KEY ("pokemon_set_id") REFERENCES "pokemon_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tokens" ADD CONSTRAINT "review_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions: invariants that schema.prisma cannot express.
-- Prisma ignores CHECK constraints and sequence settings when diffing, so
-- these do not cause schema drift. Keep them in sync with docs/database.md.
-- ===========================================================================

-- Public order numbers are HC-10001, HC-10002, ... The sequence hands out each
-- value exactly once, even under concurrent inserts (values can be skipped if
-- a transaction rolls back, but never reused).
ALTER SEQUENCE "orders_order_number_seq" MINVALUE 10001 START WITH 10001 RESTART WITH 10001;

-- Catalog -------------------------------------------------------------------

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_name_not_blank_check" CHECK (btrim("name") <> '');

ALTER TABLE "pokemon_sets"
  ADD CONSTRAINT "pokemon_sets_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "pokemon_sets_name_not_blank_check" CHECK (btrim("name") <> '');

ALTER TABLE "products"
  ADD CONSTRAINT "products_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "products_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "products_sku_not_blank_check" CHECK (btrim("sku") <> ''),
  ADD CONSTRAINT "products_price_amount_check" CHECK ("price_amount" >= 0),
  ADD CONSTRAINT "products_compare_at_price_amount_check"
    CHECK ("compare_at_price_amount" IS NULL OR "compare_at_price_amount" > "price_amount"),
  ADD CONSTRAINT "products_stock_on_hand_check" CHECK ("stock_on_hand" >= 0);

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "product_images_dimensions_check" CHECK ("width" > 0 AND "height" > 0);

-- Orders --------------------------------------------------------------------

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative_check"
    CHECK ("subtotal_amount" >= 0 AND "shipping_amount" >= 0 AND "tax_amount" >= 0),
  ADD CONSTRAINT "orders_total_amount_check"
    CHECK ("total_amount" = "subtotal_amount" + "shipping_amount"),
  ADD CONSTRAINT "orders_tax_amount_check" CHECK ("tax_amount" <= "total_amount"),
  ADD CONSTRAINT "orders_refunded_amount_check"
    CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total_amount"),
  ADD CONSTRAINT "orders_country_check" CHECK ("country" = 'SE'),
  -- A paid (or later refunded) order must have a payment time and the
  -- customer/shipping details collected by Stripe Checkout.
  ADD CONSTRAINT "orders_paid_details_check" CHECK (
    "payment_status" NOT IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
    OR (
      "paid_at" IS NOT NULL
      AND "email" IS NOT NULL
      AND "first_name" IS NOT NULL
      AND "last_name" IS NOT NULL
      AND "address_line1" IS NOT NULL
      AND "postal_code" IS NOT NULL
      AND "city" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "orders_shipped_at_check"
    CHECK ("fulfillment_status" NOT IN ('SHIPPED', 'COMPLETED') OR "shipped_at" IS NOT NULL);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_unit_price_amount_check" CHECK ("unit_price_amount" >= 0),
  ADD CONSTRAINT "order_items_total_price_amount_check"
    CHECK ("total_price_amount" = "unit_price_amount" * "quantity"),
  ADD CONSTRAINT "order_items_vat_rate_check"
    CHECK ("vat_rate_basis_points" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "order_items_snapshots_not_blank_check"
    CHECK (btrim("product_name_snapshot") <> '' AND btrim("sku_snapshot") <> '');

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0);

-- Reviews -------------------------------------------------------------------

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_verified_purchase_check"
    CHECK (NOT "verified_purchase" OR "order_item_id" IS NOT NULL),
  ADD CONSTRAINT "reviews_text_not_blank_check"
    CHECK (btrim("display_name") <> '' AND btrim("body") <> '');

ALTER TABLE "review_tokens"
  ADD CONSTRAINT "review_tokens_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "review_tokens_expiry_check" CHECK ("expires_at" > "created_at");

-- Administration ------------------------------------------------------------

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "admin_users_name_not_blank_check" CHECK (btrim("name") <> '');

ALTER TABLE "redirects"
  ADD CONSTRAINT "redirects_paths_check"
    CHECK ("source_path" ~ '^/' AND "destination_path" ~ '^/'),
  ADD CONSTRAINT "redirects_not_self_check" CHECK ("source_path" <> "destination_path");

ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 1),
  ADD CONSTRAINT "store_settings_amounts_check" CHECK (
    "shipping_price_amount" >= 0
    AND ("free_shipping_threshold_amount" IS NULL OR "free_shipping_threshold_amount" >= 0)
  ),
  ADD CONSTRAINT "store_settings_vat_rate_check" CHECK ("vat_rate_basis_points" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "store_settings_low_stock_threshold_check" CHECK ("low_stock_threshold" >= 0);
