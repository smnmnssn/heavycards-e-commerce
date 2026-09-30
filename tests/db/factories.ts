import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Minimal valid records for database tests. Each call uses a unique suffix so
 * factories can be combined freely within one test.
 */
let sequence = 0;
const next = () => ++sequence;

export async function createCategory(
  db: PrismaClient,
  overrides: Partial<Prisma.CategoryUncheckedCreateInput> = {},
) {
  const n = next();
  return db.category.create({
    data: { name: `Kategori ${n}`, slug: `kategori-${n}`, ...overrides },
  });
}

export async function createProduct(
  db: PrismaClient,
  overrides: Partial<Prisma.ProductUncheckedCreateInput> = {},
) {
  const n = next();
  const categoryId = overrides.categoryId ?? (await createCategory(db)).id;
  return db.product.create({
    data: {
      name: `Produkt ${n}`,
      slug: `produkt-${n}`,
      sku: `SKU-${n}`,
      priceAmount: 69_900,
      stockOnHand: 10,
      status: "ACTIVE",
      ...overrides,
      categoryId,
    },
  });
}

/** A pending order totalling `subtotalAmount + shippingAmount`. */
export async function createPendingOrder(
  db: PrismaClient,
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
) {
  return db.order.create({
    data: {
      subtotalAmount: 69_900,
      shippingAmount: 7_900,
      taxAmount: 15_560,
      totalAmount: 77_800,
      ...overrides,
    },
  });
}

export const paidCustomerDetails = {
  paymentStatus: "PAID",
  paidAt: new Date("2026-09-01T10:00:00Z"),
  email: "kund@example.com",
  firstName: "Kim",
  lastName: "Kund",
  addressLine1: "Testgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
} satisfies Partial<Prisma.OrderUncheckedCreateInput>;

/** A paid order with one line for `product`. */
export async function createPaidOrderWithItem(
  db: PrismaClient,
  product: { id: string; name: string; sku: string; priceAmount: number },
  quantity = 1,
) {
  const lineTotal = product.priceAmount * quantity;
  return db.order.create({
    data: {
      ...paidCustomerDetails,
      subtotalAmount: lineTotal,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: lineTotal,
      items: {
        create: {
          productId: product.id,
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          quantity,
          unitPriceAmount: product.priceAmount,
          totalPriceAmount: lineTotal,
          vatRateBasisPoints: 2_500,
        },
      },
    },
    include: { items: true },
  });
}
