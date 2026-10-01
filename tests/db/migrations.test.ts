import { readFile } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import { createTestDb } from "./test-database";

/*
 * Replays real migration files in a scratch schema inside a transaction that
 * is always rolled back, to test data migrations against rows that existed
 * before them. The test database's own schema is never touched.
 */

const db = createTestDb();
afterAll(() => db.$disconnect());

const SCHEMA = "migration_replay";

async function statements(migration: string): Promise<string[]> {
  const sql = await readFile(
    `prisma/migrations/${migration}/migration.sql`,
    "utf8",
  );
  // The migrations contain no functions or quoted semicolons.
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

class Rollback extends Error {}

describe("20261001120000_checkout_reservations", () => {
  it("merges first and last names into customer_name without losing history", async () => {
    const [init, adminAuth, checkout] = await Promise.all([
      statements("20260930205053_init"),
      statements("20261001090000_admin_auth"),
      statements("20261001120000_checkout_reservations"),
    ]);
    let rows: unknown;
    let constraints: unknown;

    await db
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
          for (const statement of [...init, ...adminAuth]) {
            await tx.$executeRawUnsafe(statement);
          }

          // Orders as Milestones 2–7 stored them.
          const order = (
            n: number,
            first: string | null,
            last: string | null,
            status = "PENDING",
          ) =>
            tx.$executeRawUnsafe(
              `INSERT INTO orders (id, order_number, first_name, last_name, subtotal_amount,
                 shipping_amount, tax_amount, total_amount, payment_status, paid_at, email,
                 address_line1, postal_code, city, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, 100, 0, 20, 100, $4::"PaymentStatus",
                 CASE WHEN $4 = 'PAID' THEN now() END, 'kund@example.com', 'Gatan 1', '111 22',
                 'Stockholm', now())`,
              n,
              first,
              last,
              status,
            );
          await order(10_001, "Anna", "Andersson", "PAID");
          await order(10_002, "  Erik ", " Eriksson  ", "PAID");
          await order(10_003, "Cher", null);
          await order(10_004, null, "Nilsson");
          await order(10_005, null, null);
          await order(10_006, "", "  ");

          for (const statement of checkout) {
            await tx.$executeRawUnsafe(statement);
          }

          rows = await tx.$queryRawUnsafe(
            `SELECT order_number AS "orderNumber", customer_name AS "customerName"
             FROM orders ORDER BY order_number`,
          );
          constraints = await tx.$queryRawUnsafe(
            `SELECT column_name AS "column" FROM information_schema.columns
             WHERE table_schema = '${SCHEMA}' AND table_name = 'orders'
               AND column_name IN ('first_name', 'last_name', 'customer_name',
                                   'checkout_attempt_id', 'checkout_expires_at')
             ORDER BY column_name`,
          );

          // The new paid-order invariant requires the merged name.
          await expect(
            tx.$executeRawUnsafe(
              `UPDATE orders SET customer_name = NULL WHERE order_number = 10001`,
            ),
          ).rejects.toThrow("orders_paid_details_check");

          throw new Rollback();
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(rows).toEqual([
      { orderNumber: 10_001, customerName: "Anna Andersson" },
      { orderNumber: 10_002, customerName: "Erik Eriksson" },
      { orderNumber: 10_003, customerName: "Cher" },
      { orderNumber: 10_004, customerName: "Nilsson" },
      { orderNumber: 10_005, customerName: null },
      { orderNumber: 10_006, customerName: null },
    ]);
    expect(constraints).toEqual([
      { column: "checkout_attempt_id" },
      { column: "checkout_expires_at" },
      { column: "customer_name" },
    ]);

    // Rolled back: nothing of the scratch schema remains.
    const schemas = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM information_schema.schemata WHERE schema_name = ${SCHEMA}`;
    expect(Number(schemas[0]!.count)).toBe(0);
  });
});

describe("20261002090000_payment_reconciliation", () => {
  it("marks only holds of attached, pending checkouts as awaiting payment", async () => {
    const migrations = await Promise.all(
      [
        "20260930205053_init",
        "20261001090000_admin_auth",
        "20261001120000_checkout_reservations",
      ].map(statements),
    );
    const reconciliation = await statements(
      "20261002090000_payment_reconciliation",
    );
    let rows: unknown;

    await db
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
          for (const statement of migrations.flat()) {
            await tx.$executeRawUnsafe(statement);
          }

          await tx.$executeRawUnsafe(
            `INSERT INTO categories (id, name, slug, updated_at)
             VALUES ('00000000-0000-7000-8000-000000000001', 'C', 'c', now())`,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO products (id, name, slug, sku, price_amount, stock_on_hand,
               status, category_id, updated_at)
             VALUES ('00000000-0000-7000-8000-000000000002', 'P', 'p', 'P-1', 100, 5,
               'ACTIVE', '00000000-0000-7000-8000-000000000001', now())`,
          );
          // order number, payment status, session, reservation status
          const cases = [
            [10_001, "PENDING", "cs_test_attached", "ACTIVE"],
            [10_002, "PENDING", null, "ACTIVE"], // provisional (never attached)
            [10_003, "EXPIRED", "cs_test_expired", "RELEASED"],
            [10_004, "PENDING", "cs_test_released", "RELEASED"],
          ] as const;
          for (const [number, status, session, reservation] of cases) {
            const orderId = `00000000-0000-7000-8000-0000000${number}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO orders (id, order_number, subtotal_amount, shipping_amount,
                 tax_amount, total_amount, payment_status, stripe_checkout_session_id,
                 updated_at)
               VALUES ($1::uuid, $2, 100, 0, 20, 100, $3::"PaymentStatus", $4, now())`,
              orderId,
              number,
              status,
              session,
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO inventory_reservations (id, order_id, product_id, quantity,
                 status, expires_at, updated_at)
               VALUES (gen_random_uuid(), $1::uuid, '00000000-0000-7000-8000-000000000002',
                 1, $2::"ReservationStatus", now(), now())`,
              orderId,
              reservation,
            );
          }

          for (const statement of reconciliation) {
            await tx.$executeRawUnsafe(statement);
          }
          rows = await tx.$queryRawUnsafe(
            `SELECT o.order_number AS "orderNumber", r.awaiting_payment AS "awaiting"
             FROM inventory_reservations r JOIN orders o ON o.id = r.order_id
             ORDER BY o.order_number`,
          );
          throw new Rollback();
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(rows).toEqual([
      { orderNumber: 10_001, awaiting: true },
      { orderNumber: 10_002, awaiting: false },
      { orderNumber: 10_003, awaiting: false },
      { orderNumber: 10_004, awaiting: false },
    ]);
  });
});
