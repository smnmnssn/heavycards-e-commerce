import { readdir, readFile } from "node:fs/promises";

import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapOwner } from "@/server/admin/bootstrap";

import { assertNoRealAdministrators } from "../../prisma/seed/guard";
import { seedDatabase } from "../../prisma/seed/seed-database";
import { createTestDb, resetDatabase } from "./test-database";

/*
 * Production bootstrap (Milestone 15, docs/launch-runbook.md): a production
 * database is created by the migrations alone, then receives its first OWNER
 * from `npm run admin:create-owner`; the owner creates the store settings
 * and the catalog in /admin. No demo data may reach it on any of these paths.
 */

const db = createTestDb();
afterAll(() => db.$disconnect());

const SCHEMA = "production_bootstrap";

class Rollback extends Error {}

async function allMigrationStatements(): Promise<string[]> {
  const directories = (
    await readdir("prisma/migrations", { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const statements: string[] = [];
  for (const directory of directories) {
    const sql = await readFile(
      `prisma/migrations/${directory}/migration.sql`,
      "utf8",
    );
    // The migrations contain no functions or quoted semicolons.
    statements.push(
      ...sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean),
    );
  }
  return statements;
}

describe("a database created by the migrations alone", () => {
  it("has every table but not a single row: no demo data, admins or settings", async () => {
    const statements = await allMigrationStatements();
    let counts: Record<string, number> = {};
    let firstOrderNumber: bigint | undefined;

    await db
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement);
          }
          const tables = await tx.$queryRaw<Array<{ tablename: string }>>`
            SELECT tablename FROM pg_tables WHERE schemaname = ${SCHEMA}
            ORDER BY tablename`;
          for (const { tablename } of tables) {
            const [row] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
              `SELECT count(*)::int AS n FROM ${SCHEMA}."${tablename}"`,
            );
            counts[tablename] = row!.n;
          }
          const [sequence] = await tx.$queryRawUnsafe<Array<{ value: bigint }>>(
            `SELECT nextval('${SCHEMA}.orders_order_number_seq') AS value`,
          );
          firstOrderNumber = sequence!.value;
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(Object.keys(counts)).toEqual(
      expect.arrayContaining([
        "admin_users",
        "categories",
        "orders",
        "pokemon_sets",
        "products",
        "redirects",
        "reviews",
        "store_settings",
      ]),
    );
    counts = Object.fromEntries(
      Object.entries(counts).filter(([, count]) => count !== 0),
    );
    expect(counts).toEqual({});
    // The first real order is HC-10001.
    expect(firstOrderNumber).toBe(10_001n);
  });
});

describe("seed safety on a bootstrapped database", () => {
  beforeEach(async () => {
    await resetDatabase(db);
  });

  it("refuses once the database has its real OWNER", async () => {
    const result = await bootstrapOwner(db, {
      name: "Butiksägare",
      email: "owner@heavycards-butik.se",
      password: "a-long-bootstrap-password-for-tests",
      hashPassword,
    });
    expect(result.ok).toBe(true);

    await expect(assertNoRealAdministrators(db)).rejects.toThrow(
      /real administrators/,
    );
  });

  it("allows a development database (seed and E2E administrators use .test)", async () => {
    await seedDatabase(db, new Date());
    await db.adminUser.create({
      data: {
        name: "E2E",
        email: "e2e-invite-1@heavycards.test",
        role: "ADMIN",
        isActive: false,
      },
    });

    await expect(assertNoRealAdministrators(db)).resolves.toBeUndefined();
  });
});
