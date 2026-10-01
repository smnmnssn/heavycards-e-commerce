import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import { setAdminActive } from "@/server/admin/admin-users";
import { bootstrapOwner } from "@/server/admin/bootstrap";

import {
  createAdmin,
  createTestAuth,
  randomPassword,
  signIn,
} from "./auth-helpers";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const { auth } = createTestAuth(db);

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("OWNER vs ADMIN permissions", () => {
  it("lets an OWNER deactivate and reactivate an ADMIN, with audit entries", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });
    const admin = await createAdmin(db);

    expect(
      await setAdminActive(db, {
        actorId: owner.id,
        targetId: admin.id,
        active: false,
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await setAdminActive(db, {
        actorId: owner.id,
        targetId: admin.id,
        active: true,
      }),
    ).toEqual({ ok: true, changed: true });

    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(
      logs.map((log) => [log.action, log.adminUserId, log.entityId]),
    ).toEqual([
      ["DEACTIVATE_ADMIN", owner.id, admin.id],
      ["REACTIVATE_ADMIN", owner.id, admin.id],
    ]);
  });

  it("refuses OWNER-only operations for an ADMIN", async () => {
    await createAdmin(db, { role: "OWNER" });
    const actor = await createAdmin(db);
    const target = await createAdmin(db);

    await expect(
      setAdminActive(db, {
        actorId: actor.id,
        targetId: target.id,
        active: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await db.adminUser.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ isActive: true });
    expect(await db.auditLog.count()).toBe(0);
  });

  it("refuses an OWNER who has since been deactivated", async () => {
    await createAdmin(db, { role: "OWNER" });
    const formerOwner = await createAdmin(db, {
      role: "OWNER",
      isActive: false,
    });
    const target = await createAdmin(db);

    await expect(
      setAdminActive(db, {
        actorId: formerOwner.id,
        targetId: target.id,
        active: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reports unknown administrators and no-op changes", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });
    const admin = await createAdmin(db);

    expect(
      await setAdminActive(db, {
        actorId: owner.id,
        targetId: "01999999-0000-7000-8000-000000000000",
        active: false,
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      await setAdminActive(db, {
        actorId: owner.id,
        targetId: admin.id,
        active: true,
      }),
    ).toEqual({ ok: true, changed: false });
  });
});

describe("final OWNER protection", () => {
  it("never deactivates the only active OWNER", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });

    expect(
      await setAdminActive(db, {
        actorId: owner.id,
        targetId: owner.id,
        active: false,
      }),
    ).toEqual({ ok: false, error: "LAST_OWNER" });
    expect(
      await db.adminUser.findUniqueOrThrow({ where: { id: owner.id } }),
    ).toMatchObject({ isActive: true, role: "OWNER" });
  });

  it("lets one OWNER deactivate another, but not leave none", async () => {
    const first = await createAdmin(db, { role: "OWNER" });
    const second = await createAdmin(db, { role: "OWNER" });

    // Owners cannot lock themselves out while another owner exists.
    expect(
      await setAdminActive(db, {
        actorId: first.id,
        targetId: first.id,
        active: false,
      }),
    ).toEqual({ ok: false, error: "SELF" });

    expect(
      await setAdminActive(db, {
        actorId: first.id,
        targetId: second.id,
        active: false,
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await setAdminActive(db, {
        actorId: first.id,
        targetId: first.id,
        active: false,
      }),
    ).toEqual({ ok: false, error: "LAST_OWNER" });
  });

  it("keeps an OWNER when two owners deactivate each other at the same time", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase(db);
      const a = await createAdmin(db, { role: "OWNER" });
      const b = await createAdmin(db, { role: "OWNER" });

      const results = await Promise.allSettled([
        setAdminActive(db, { actorId: a.id, targetId: b.id, active: false }),
        setAdminActive(db, { actorId: b.id, targetId: a.id, active: false }),
      ]);

      const succeeded = results.filter(
        (result) => result.status === "fulfilled" && result.value.ok,
      );
      expect(succeeded).toHaveLength(1);
      expect(
        await db.adminUser.count({ where: { role: "OWNER", isActive: true } }),
      ).toBe(1);
    }
  });
});

describe("first-OWNER bootstrap", () => {
  it("creates an active OWNER with a Better Auth credential", async () => {
    const password = randomPassword();

    const result = await bootstrapOwner(db, {
      name: "  Första Ägaren ",
      email: " Owner@Example.COM ",
      password,
      hashPassword,
    });

    expect(result).toMatchObject({ ok: true, email: "owner@example.com" });
    const owner = await db.adminUser.findUniqueOrThrow({
      where: { email: "owner@example.com" },
      include: { accounts: true },
    });
    expect(owner).toMatchObject({
      name: "Första Ägaren",
      role: "OWNER",
      isActive: true,
    });
    expect(owner.accounts).toHaveLength(1);
    expect(owner.accounts[0]!.password).not.toContain(password);
    expect(
      await db.auditLog.findFirstOrThrow({ where: { entityId: owner.id } }),
    ).toMatchObject({ action: "BOOTSTRAP_OWNER" });

    expect((await signIn(auth, "owner@example.com", password)).status).toBe(
      200,
    );
  });

  it("refuses when an active OWNER already exists", async () => {
    await createAdmin(db, { role: "OWNER" });

    const result = await bootstrapOwner(db, {
      name: "Ny",
      email: "new@example.com",
      password: randomPassword(),
      hashPassword,
    });

    expect(result).toMatchObject({ ok: false, error: "OWNER_EXISTS" });
    expect(await db.adminUser.count()).toBe(1);
  });

  it("refuses an existing email and short passwords", async () => {
    const existing = await createAdmin(db, { isActive: false });

    expect(
      await bootstrapOwner(db, {
        name: "Ny",
        email: existing.email,
        password: randomPassword(),
        hashPassword,
      }),
    ).toMatchObject({ ok: false, error: "EMAIL_EXISTS" });
    expect(
      await bootstrapOwner(db, {
        name: "Ny",
        email: "new@example.com",
        password: "elevenchars",
        hashPassword,
      }),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await db.adminAccount.count()).toBe(0);
  });

  it("creates only one OWNER when run concurrently", async () => {
    const results = await Promise.all(
      ["a@example.com", "b@example.com"].map((email) =>
        bootstrapOwner(db, {
          name: "Ägare",
          email,
          password: randomPassword(),
          hashPassword,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.adminUser.count({ where: { role: "OWNER" } })).toBe(1);
  });
});
