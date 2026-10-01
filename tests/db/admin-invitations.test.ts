import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/authorization";
import { createMemoryTransport } from "@/lib/email/transport";
import { hashToken } from "@/lib/security/tokens";
import {
  acceptInvitation,
  findUsableInvitation,
  inviteAdmin,
  revokeInvitation,
} from "@/server/admin/invitations";

import {
  createAdmin,
  createTestAuth,
  randomPassword,
  signIn,
} from "./auth-helpers";
import { createTestDb, resetDatabase } from "./test-database";

const db = createTestDb();
const { auth } = createTestAuth(db);
const SITE_URL = "http://localhost:3000";
const HOUR_MS = 60 * 60 * 1000;

let mail: ReturnType<typeof createMemoryTransport>;
beforeEach(async () => {
  await resetDatabase(db);
  mail = createMemoryTransport();
});
afterAll(() => db.$disconnect());

/** Invites as a fresh OWNER and returns the raw token from the email. */
async function invite(
  input: Record<string, unknown> = {
    name: "Ny Admin",
    email: "ny@example.com",
  },
  now = new Date(),
) {
  const owner = await createAdmin(db, { role: "OWNER" });
  const result = await inviteAdmin(db, mail, {
    actorId: owner.id,
    input,
    siteUrl: SITE_URL,
    now,
  });
  const link = mail.messages.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  const token = link ? new URL(link).searchParams.get("token") : null;
  return { owner, result, link, token: token ?? "" };
}

const accept = (token: string, password = randomPassword(), now?: Date) =>
  acceptInvitation(db, { token, password, hashPassword, now });

describe("creating invitations", () => {
  it("emails a single-use link and stores only the token hash", async () => {
    const now = new Date();
    const { owner, result, link, token } = await invite(undefined, now);

    expect(result).toMatchObject({ ok: true });
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]!.to).toBe("ny@example.com");
    expect(link).toMatch(/^http:\/\/localhost:3000\/admin\/invite\?token=/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await db.adminInvitation.findFirstOrThrow();
    expect(row).toMatchObject({
      email: "ny@example.com",
      name: "Ny Admin",
      role: "ADMIN",
      invitedById: owner.id,
      tokenHash: hashToken(token),
      acceptedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - now.getTime()).toBe(72 * HOUR_MS);

    const audit = await db.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({
      action: "INVITE_ADMIN",
      adminUserId: owner.id,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(token);
  });

  it("ignores a tampered role and always invites an ADMIN", async () => {
    const { token } = await invite({
      name: "Angripare",
      email: "x@example.com",
      role: "OWNER",
    });

    expect(await db.adminInvitation.findFirstOrThrow()).toMatchObject({
      role: "ADMIN",
    });
    const accepted = await accept(token);
    expect(accepted.ok).toBe(true);
    expect(
      await db.adminUser.findUniqueOrThrow({
        where: { email: "x@example.com" },
      }),
    ).toMatchObject({ role: "ADMIN" });
  });

  it("refuses an ADMIN as inviter", async () => {
    await createAdmin(db, { role: "OWNER" });
    const admin = await createAdmin(db);

    await expect(
      inviteAdmin(db, mail, {
        actorId: admin.id,
        input: { name: "X", email: "x@example.com" },
        siteUrl: SITE_URL,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.adminInvitation.count()).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });

  it("rejects invalid input and existing administrators", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });
    const existing = await createAdmin(db);

    expect(
      await inviteAdmin(db, mail, {
        actorId: owner.id,
        input: { name: "", email: "inte-en-adress" },
        siteUrl: SITE_URL,
      }),
    ).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      fieldErrors: { name: expect.any(String), email: expect.any(String) },
    });
    expect(
      await inviteAdmin(db, mail, {
        actorId: owner.id,
        input: { name: "Dubblett", email: existing.email.toUpperCase() },
        siteUrl: SITE_URL,
      }),
    ).toEqual({ ok: false, error: "ALREADY_ADMIN" });
    expect(mail.messages).toHaveLength(0);
  });

  it("revokes the previous open invitation when re-inviting", async () => {
    const { owner, token: first } = await invite();
    await inviteAdmin(db, mail, {
      actorId: owner.id,
      input: { name: "Ny Admin", email: "ny@example.com" },
      siteUrl: SITE_URL,
    });
    const second = new URL(
      mail.messages[1]!.text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get("token")!;

    expect(await findUsableInvitation(db, first)).toBeNull();
    expect(await findUsableInvitation(db, second)).not.toBeNull();
    expect(await db.adminInvitation.count({ where: { revokedAt: null } })).toBe(
      1,
    );
  });

  it("revokes the invitation if the email cannot be sent", async () => {
    const owner = await createAdmin(db, { role: "OWNER" });
    const failing = {
      send: async () => {
        throw new Error("smtp down");
      },
    };

    const result = await inviteAdmin(db, failing, {
      actorId: owner.id,
      input: { name: "X", email: "x@example.com" },
      siteUrl: SITE_URL,
    });

    expect(result).toEqual({ ok: false, error: "EMAIL_FAILED" });
    expect(await db.adminInvitation.findFirstOrThrow()).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});

describe("accepting invitations", () => {
  it("creates an active ADMIN who can sign in, and records the acceptance", async () => {
    const { token } = await invite();
    const password = randomPassword();

    const result = await accept(token, password);

    expect(result).toMatchObject({ ok: true, email: "ny@example.com" });
    const admin = await db.adminUser.findUniqueOrThrow({
      where: { email: "ny@example.com" },
      include: { accounts: true },
    });
    expect(admin).toMatchObject({
      name: "Ny Admin",
      role: "ADMIN",
      isActive: true,
      emailVerified: true,
    });
    expect(admin.accounts).toHaveLength(1);
    expect(admin.accounts[0]).toMatchObject({
      providerId: "credential",
      accountId: admin.id,
    });
    expect(await db.adminInvitation.findFirstOrThrow()).toMatchObject({
      acceptedById: admin.id,
      acceptedAt: expect.any(Date),
    });
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { action: "ACCEPT_ADMIN_INVITATION" },
      }),
    ).toMatchObject({ adminUserId: admin.id });

    expect((await signIn(auth, "ny@example.com", password)).status).toBe(200);
  });

  it("can be used only once", async () => {
    const { token } = await invite();

    expect((await accept(token)).ok).toBe(true);
    expect(await accept(token)).toEqual({ ok: false, error: "INVALID_TOKEN" });
    expect(await db.adminUser.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("accepts exactly one of several concurrent submissions", async () => {
    const { token } = await invite();

    const results = await Promise.all([
      accept(token),
      accept(token),
      accept(token),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await db.adminUser.count({ where: { email: "ny@example.com" } }),
    ).toBe(1);
  });

  it("fails safely for expired, revoked and invalid tokens", async () => {
    const issued = new Date(Date.now() - 73 * HOUR_MS);
    const { token: expired } = await invite(
      { name: "Gammal", email: "gammal@example.com" },
      issued,
    );
    const { owner, token: revoked } = await invite({
      name: "Återkallad",
      email: "aterkallad@example.com",
    });
    const invitation = await db.adminInvitation.findFirstOrThrow({
      where: { email: "aterkallad@example.com" },
    });
    expect(
      await revokeInvitation(db, {
        actorId: owner.id,
        invitationId: invitation.id,
      }),
    ).toEqual({ ok: true });

    for (const token of [
      expired,
      revoked,
      "",
      "garbage",
      "A".repeat(43),
      revoked.slice(0, -1),
    ]) {
      expect(await accept(token)).toEqual({
        ok: false,
        error: "INVALID_TOKEN",
      });
    }
    expect(await db.adminUser.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("keeps the invitation usable after a too-short password", async () => {
    const { token } = await invite();

    expect(await accept(token, "elevenchars")).toMatchObject({
      ok: false,
      error: "INVALID_PASSWORD",
    });
    expect((await accept(token)).ok).toBe(true);
  });

  it("retires the invitation if the address became an admin meanwhile", async () => {
    const { token } = await invite();
    await createAdmin(db, { email: "ny@example.com" });

    expect(await accept(token)).toEqual({ ok: false, error: "INVALID_TOKEN" });
    expect(await db.adminInvitation.findFirstOrThrow()).toMatchObject({
      revokedAt: expect.any(Date),
      acceptedAt: null,
    });
  });

  it("only lets an OWNER revoke invitations", async () => {
    await invite();
    const admin = await createAdmin(db);
    const invitation = await db.adminInvitation.findFirstOrThrow();

    await expect(
      revokeInvitation(db, { actorId: admin.id, invitationId: invitation.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
