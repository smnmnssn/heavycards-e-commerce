import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashToken, generateSecureToken } from "@/lib/security/tokens";

import {
  createCategory,
  createPaidOrderWithItem,
  createPendingOrder,
  createProduct,
  paidCustomerDetails,
} from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("historical order data", () => {
  it("keeps order item snapshots when the product changes later", async () => {
    const product = await createProduct(db, {
      name: "Destined Rivals Booster Box",
      sku: "SV10-BB-EN",
      priceAmount: 149_900,
    });
    const order = await createPaidOrderWithItem(db, product, 2);

    await db.product.update({
      where: { id: product.id },
      data: {
        name: "Destined Rivals Booster Box (ny utgåva)",
        sku: "SV10-BB-EN-V2",
        priceAmount: 179_900,
      },
    });

    const item = await db.orderItem.findUniqueOrThrow({
      where: { id: order.items[0]!.id },
    });
    expect(item).toMatchObject({
      productNameSnapshot: "Destined Rivals Booster Box",
      skuSnapshot: "SV10-BB-EN",
      unitPriceAmount: 149_900,
      totalPriceAmount: 299_800,
      quantity: 2,
    });
  });
});

describe("delete and archive behavior", () => {
  it("blocks deleting a product with order history; archiving keeps the order intact", async () => {
    const product = await createProduct(db);
    const order = await createPaidOrderWithItem(db, product);

    await expect(
      db.product.delete({ where: { id: product.id } }),
    ).rejects.toThrow("order_items_product_id_fkey");

    await db.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED" },
    });
    const reloaded = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { product: true } } },
    });
    expect(reloaded.items[0]!.product.status).toBe("ARCHIVED");
  });

  it("deletes a product without history together with its image rows", async () => {
    const product = await createProduct(db);
    await db.productImage.create({
      data: {
        productId: product.id,
        storageKey: "products/test.webp",
        url: "https://blob.example.com/products/test.webp",
        position: 0,
        width: 1200,
        height: 1200,
      },
    });

    await db.product.delete({ where: { id: product.id } });

    expect(await db.productImage.count()).toBe(0);
  });

  it("blocks deleting categories and sets that products still use", async () => {
    const set = await db.pokemonSet.create({
      data: { name: "Destined Rivals", slug: "destined-rivals" },
    });
    const product = await createProduct(db, { pokemonSetId: set.id });

    await expect(
      db.category.delete({ where: { id: product.categoryId } }),
    ).rejects.toThrow("products_category_id_fkey");
    await expect(
      db.pokemonSet.delete({ where: { id: set.id } }),
    ).rejects.toThrow("products_pokemon_set_id_fkey");
  });

  it("blocks deleting orders, which are financial records", async () => {
    const order = await createPaidOrderWithItem(db, await createProduct(db));

    await expect(db.order.delete({ where: { id: order.id } })).rejects.toThrow(
      "order_items_order_id_fkey",
    );
  });

  it("blocks deleting an administrator who has audit history", async () => {
    const admin = await db.adminUser.create({
      data: { name: "Admin", email: "admin@example.com", isActive: true },
    });
    await db.auditLog.create({
      data: {
        adminUserId: admin.id,
        action: "UPDATE_PRODUCT_STOCK",
        entityType: "Product",
        entityId: "x",
        metadata: { from: 15, to: 12 },
      },
    });

    await expect(
      db.adminUser.delete({ where: { id: admin.id } }),
    ).rejects.toThrow("audit_logs_admin_user_id_fkey");
  });
});

describe("catalog constraints", () => {
  it("rejects negative stock", async () => {
    await expect(createProduct(db, { stockOnHand: -1 })).rejects.toThrow(
      "products_stock_on_hand_check",
    );
  });

  it("rejects a compare-at price that is not above the price", async () => {
    await expect(
      createProduct(db, { priceAmount: 10_000, compareAtPriceAmount: 10_000 }),
    ).rejects.toThrow("products_compare_at_price_amount_check");
  });

  it.each([
    "Destined-Rivals",
    "destined rivals",
    "-destined",
    "destined--rivals",
  ])("rejects non-canonical slug %j", async (slug) => {
    await expect(createCategory(db, { slug })).rejects.toThrow(
      "categories_slug_format_check",
    );
  });

  it("rejects duplicate SKUs", async () => {
    await createProduct(db, { sku: "DUP-1" });

    await expect(createProduct(db, { sku: "DUP-1" })).rejects.toThrow(
      "products_sku_key",
    );
  });
});

describe("order constraints", () => {
  it("rejects a total that is not subtotal + shipping", async () => {
    await expect(
      createPendingOrder(db, { totalAmount: 77_801 }),
    ).rejects.toThrow("orders_total_amount_check");
  });

  it("rejects a paid order without customer details from checkout", async () => {
    await expect(
      createPendingOrder(db, { paymentStatus: "PAID", paidAt: new Date() }),
    ).rejects.toThrow("orders_paid_details_check");
  });

  it("requires the full customer name once paid, but not while pending", async () => {
    const pending = await createPendingOrder(db);
    expect(pending.customerName).toBeNull();

    await expect(
      createPendingOrder(db, { ...paidCustomerDetails, customerName: null }),
    ).rejects.toThrow("orders_paid_details_check");
    await expect(
      db.order.update({
        where: { id: pending.id },
        data: { ...paidCustomerDetails },
      }),
    ).resolves.toMatchObject({ customerName: "Kim Kund" });
  });

  it.each(["", "   "])(
    "rejects a blank customer name (%j)",
    async (customerName) => {
      await expect(createPendingOrder(db, { customerName })).rejects.toThrow(
        "orders_customer_name_not_blank_check",
      );
    },
  );

  it.each(["email", "addressLine1", "postalCode", "city", "paidAt"] as const)(
    "requires %s once paid",
    async (field) => {
      await expect(
        createPendingOrder(db, { ...paidCustomerDetails, [field]: null }),
      ).rejects.toThrow("orders_paid_details_check");
    },
  );

  it("stores the full name as one value, never split", async () => {
    const order = await createPendingOrder(db, {
      ...paidCustomerDetails,
      customerName: "Anna-Karin von Essen Lindqvist",
    });
    expect(order.customerName).toBe("Anna-Karin von Essen Lindqvist");
  });

  it("allows one order per checkout attempt", async () => {
    const attempt = "0199a3b4-0000-4000-8000-000000000001";
    await createPendingOrder(db, { checkoutAttemptId: attempt });
    await expect(
      createPendingOrder(db, { checkoutAttemptId: attempt }),
    ).rejects.toThrow("orders_checkout_attempt_id_key");
  });

  it("accepts a paid order with customer details", async () => {
    const order = await createPendingOrder(db, paidCustomerDetails);

    expect(order.paymentStatus).toBe("PAID");
    expect(order.fulfillmentStatus).toBe("NEW");
  });

  it("rejects refunds larger than the order total", async () => {
    await expect(
      createPendingOrder(db, {
        ...paidCustomerDetails,
        refundedAmount: 77_801,
      }),
    ).rejects.toThrow("orders_refunded_amount_check");
  });

  it("requires shippedAt for shipped orders", async () => {
    await expect(
      createPendingOrder(db, {
        ...paidCustomerDetails,
        fulfillmentStatus: "SHIPPED",
      }),
    ).rejects.toThrow("orders_shipped_at_check");
  });

  it("rejects countries other than Sweden", async () => {
    await expect(createPendingOrder(db, { country: "NO" })).rejects.toThrow(
      "orders_country_check",
    );
  });

  it("rejects an order item whose total is not unit price × quantity", async () => {
    const product = await createProduct(db);
    const order = await createPendingOrder(db);

    await expect(
      db.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          quantity: 2,
          unitPriceAmount: 100,
          totalPriceAmount: 100,
          vatRateBasisPoints: 2_500,
        },
      }),
    ).rejects.toThrow("order_items_total_price_amount_check");
  });

  it("allows only one line per product per order", async () => {
    const product = await createProduct(db);
    const order = await createPaidOrderWithItem(db, product);

    await expect(
      db.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          quantity: 1,
          unitPriceAmount: product.priceAmount,
          totalPriceAmount: product.priceAmount,
          vatRateBasisPoints: 2_500,
        },
      }),
    ).rejects.toThrow("order_items_order_id_product_id_key");
  });

  it("rejects zero-quantity reservations and duplicate reservation lines", async () => {
    const product = await createProduct(db);
    const order = await createPendingOrder(db);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await expect(
      db.inventoryReservation.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity: 0,
          expiresAt,
        },
      }),
    ).rejects.toThrow("inventory_reservations_quantity_check");

    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        expiresAt,
      },
    });
    await expect(
      db.inventoryReservation.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity: 1,
          expiresAt,
        },
      }),
    ).rejects.toThrow("inventory_reservations_order_id_product_id_key");
  });
});

describe("Stripe event idempotency", () => {
  it("processes an event once: a redelivery rolls back its side effects", async () => {
    const order = await createPendingOrder(db, paidCustomerDetails);

    // The pattern Milestone 9 uses: record the event and apply its effects in
    // one transaction, so the unique event id makes redelivery a no-op.
    const processEvent = () =>
      db.$transaction(async (tx) => {
        await tx.stripeEvent.create({
          data: { stripeEventId: "evt_test_123", type: "charge.refunded" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            refundedAmount: { increment: 1_000 },
            paymentStatus: "PARTIALLY_REFUNDED",
          },
        });
      });

    await processEvent();
    await expect(processEvent()).rejects.toThrow(
      "stripe_events_stripe_event_id_key",
    );

    const reloaded = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(reloaded.refundedAmount).toBe(1_000);
    expect(await db.stripeEvent.count()).toBe(1);
  });
});

describe("review constraints", () => {
  async function purchasedItem() {
    const product = await createProduct(db);
    const order = await createPaidOrderWithItem(db, product);
    return { product, order, item: order.items[0]! };
  }

  it("allows one review per purchased order item", async () => {
    const { product, item } = await purchasedItem();
    const review = {
      productId: product.id,
      orderItemId: item.id,
      displayName: "Kim",
      rating: 5,
      body: "Bra!",
      verifiedPurchase: true,
    };

    await db.review.create({ data: review });
    await expect(db.review.create({ data: review })).rejects.toThrow(
      "reviews_order_item_id_key",
    );
  });

  it("rejects a verified review that is not linked to a purchase", async () => {
    const product = await createProduct(db);

    await expect(
      db.review.create({
        data: {
          productId: product.id,
          displayName: "Kim",
          rating: 5,
          body: "Bra!",
          verifiedPurchase: true,
        },
      }),
    ).rejects.toThrow("reviews_verified_purchase_check");
  });

  it.each([0, 6])("rejects rating %i", async (rating) => {
    const product = await createProduct(db);

    await expect(
      db.review.create({
        data: { productId: product.id, displayName: "Kim", rating, body: "x" },
      }),
    ).rejects.toThrow("reviews_rating_check");
  });

  it("defaults new reviews to PENDING", async () => {
    const { product, item } = await purchasedItem();

    const review = await db.review.create({
      data: {
        productId: product.id,
        orderItemId: item.id,
        displayName: "Kim",
        rating: 4,
        body: "Bra!",
        verifiedPurchase: true,
      },
    });

    expect(review.status).toBe("PENDING");
  });

  it("stores review tokens only as SHA-256 hashes", async () => {
    const { order } = await purchasedItem();
    const rawToken = generateSecureToken();
    const nonce = generateSecureToken();
    const expiresAt = new Date(Date.now() + 86_400_000);

    await db.reviewToken.create({
      data: {
        orderId: order.id,
        nonce,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });
    const found = await db.reviewToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    expect(found?.orderId).toBe(order.id);
    const { order: other } = await purchasedItem();
    await expect(
      db.reviewToken.create({
        data: { orderId: other.id, nonce, tokenHash: rawToken, expiresAt },
      }),
    ).rejects.toThrow("review_tokens_token_hash_format_check");
  });

  it("allows one review invitation per order, with a well-formed nonce (Milestone 11)", async () => {
    const { order } = await purchasedItem();
    const invitation = () => ({
      orderId: order.id,
      nonce: generateSecureToken(),
      tokenHash: hashToken(generateSecureToken()),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.reviewToken.create({ data: invitation() });

    await expect(db.reviewToken.create({ data: invitation() })).rejects.toThrow(
      /Unique constraint/,
    );
    const { order: other } = await purchasedItem();
    await expect(
      db.reviewToken.create({
        data: { ...invitation(), orderId: other.id, nonce: "too-short" },
      }),
    ).rejects.toThrow("review_tokens_nonce_format_check");
    await expect(
      db.reviewToken.create({
        data: {
          ...invitation(),
          orderId: other.id,
          createdAt: new Date(),
          revokedAt: new Date(Date.now() - 60_000),
        },
      }),
    ).rejects.toThrow("review_tokens_revoked_check");
  });
});

describe("audit log", () => {
  it("records system actions with a NULL admin, never an empty-string pseudo-ID", async () => {
    const entry = await db.auditLog.create({
      data: {
        action: "MARK_ORDER_PAID",
        entityType: "Order",
        entityId: "x",
      },
    });
    expect(entry.adminUserId).toBeNull();

    // admin_user_id is a native uuid column: an empty string cannot be stored.
    await expect(
      db.auditLog.create({
        data: {
          adminUserId: "",
          action: "MARK_ORDER_PAID",
          entityType: "Order",
          entityId: "x",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("administration constraints", () => {
  it("requires normalized lowercase admin emails, unique per person", async () => {
    await expect(
      db.adminUser.create({ data: { name: "A", email: "Owner@Example.com" } }),
    ).rejects.toThrow("admin_users_email_normalized_check");

    await db.adminUser.create({
      data: { name: "A", email: "owner@example.com" },
    });
    await expect(
      db.adminUser.create({ data: { name: "B", email: "owner@example.com" } }),
    ).rejects.toThrow("admin_users_email_key");
  });

  it("new admins default to ADMIN and inactive", async () => {
    const admin = await db.adminUser.create({
      data: { name: "Ny", email: "ny@example.com" },
    });

    expect(admin).toMatchObject({
      role: "ADMIN",
      isActive: false,
      emailVerified: false,
    });
    // Credentials live only in admin_accounts (Better Auth).
    expect(await db.adminAccount.count({ where: { userId: admin.id } })).toBe(
      0,
    );
  });

  it("keeps store settings a single row", async () => {
    const settings = {
      storeName: "HeavyCards",
      contactEmail: "kundservice@example.com",
      shippingPriceAmount: 7_900,
      lowStockThreshold: 3,
    };
    await db.storeSettings.create({ data: settings });

    await expect(
      db.storeSettings.create({ data: { ...settings, id: 2 } }),
    ).rejects.toThrow("store_settings_singleton_check");
  });

  it("rejects self-redirects and non-path redirects", async () => {
    await expect(
      db.redirect.create({
        data: { sourcePath: "/set/a", destinationPath: "/set/a" },
      }),
    ).rejects.toThrow("redirects_not_self_check");
    await expect(
      db.redirect.create({
        data: { sourcePath: "/set/a", destinationPath: "https://evil.example" },
      }),
    ).rejects.toThrow("redirects_paths_check");
  });
});
