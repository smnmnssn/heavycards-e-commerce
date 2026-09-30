import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  FIRST_ORDER_NUMBER,
  formatOrderNumber,
} from "@/server/domain/order-number";

import { createPendingOrder } from "./factories";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("order numbers", () => {
  it("start at HC-10001 and increase", async () => {
    const first = await createPendingOrder(db);
    const second = await createPendingOrder(db);

    expect(first.orderNumber).toBe(FIRST_ORDER_NUMBER);
    expect(formatOrderNumber(first.orderNumber)).toBe("HC-10001");
    expect(second.orderNumber).toBe(FIRST_ORDER_NUMBER + 1);
  });

  it("are unique under concurrent order creation", async () => {
    const orders = await Promise.all(
      Array.from({ length: 25 }, () => createPendingOrder(db)),
    );
    const numbers = orders.map((order) => order.orderNumber);

    expect(new Set(numbers).size).toBe(25);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(FIRST_ORDER_NUMBER);
  });

  it("are never reused after a rolled-back transaction (gaps are allowed)", async () => {
    let rolledBackNumber = 0;
    await expect(
      db.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            subtotalAmount: 100,
            shippingAmount: 0,
            taxAmount: 20,
            totalAmount: 100,
          },
        });
        rolledBackNumber = order.orderNumber;
        throw new Error("simulated checkout failure");
      }),
    ).rejects.toThrow("simulated checkout failure");

    const next = await createPendingOrder(db);

    expect(next.orderNumber).toBeGreaterThan(rolledBackNumber);
    expect(await db.order.count()).toBe(1);
  });

  it("cannot be duplicated even if application code sets one explicitly", async () => {
    const existing = await createPendingOrder(db);

    await expect(
      createPendingOrder(db, { orderNumber: existing.orderNumber }),
    ).rejects.toThrow("orders_order_number_key");
  });
});
