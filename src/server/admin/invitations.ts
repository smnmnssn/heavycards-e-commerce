import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { INVITATION_TTL_HOURS } from "@/lib/auth/policy";
import { ADMIN_INVITE_PATH } from "@/lib/auth/routes";
import { invitationEmail } from "@/lib/email/templates";
import type { EmailTransport } from "@/lib/email/transport";
import {
  generateSecureToken,
  hashToken,
  isWellFormedToken,
} from "@/lib/security/tokens";
import { adminPasswordSchema, inviteAdminSchema } from "@/lib/validation/admin";

import { assertActingOwner } from "./admin-users";
import { ADMIN_AUDIT_ACTIONS, AUDIT_ENTITY_ADMIN_INVITATION } from "./audit";

const HOUR_MS = 60 * 60 * 1000;

class InvitationUnavailableError extends Error {}

/** V1 invitations always create ADMIN accounts (PROJECT.md §50). */
const INVITED_ROLE = "ADMIN" as const;

export type InviteAdminResult =
  | { ok: true; invitationId: string; expiresAt: Date }
  | {
      ok: false;
      error: "INVALID_INPUT" | "ALREADY_ADMIN" | "EMAIL_FAILED";
      fieldErrors?: Partial<Record<"name" | "email", string>>;
    };

/**
 * Invites a new ADMIN (OWNER only) and emails the single-use link.
 *
 * `input` is untrusted form data: only name and email are read from it, so a
 * tampered `role` field has no effect. Any earlier open invitation for the
 * same address is revoked. If the email cannot be delivered the new
 * invitation is revoked as well, so no unknown valid link exists.
 */
export async function inviteAdmin(
  db: PrismaClient,
  email: EmailTransport,
  {
    actorId,
    input,
    siteUrl,
    now = new Date(),
  }: { actorId: string; input: unknown; siteUrl: string; now?: Date },
): Promise<InviteAdminResult> {
  const parsed = inviteAdminSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"name" | "email", string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "name" || field === "email") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, error: "INVALID_INPUT", fieldErrors };
  }

  const rawToken = generateSecureToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_HOURS * HOUR_MS);

  const created = await db.$transaction(async (tx) => {
    await assertActingOwner(tx, actorId);

    const existing = await tx.adminUser.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (existing) return null;

    await tx.adminInvitation.updateMany({
      where: { email: parsed.data.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const invitation = await tx.adminInvitation.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        role: INVITED_ROLE,
        tokenHash: hashToken(rawToken),
        invitedById: actorId,
        expiresAt,
        createdAt: now,
      },
      select: { id: true, invitedBy: { select: { name: true } } },
    });
    await tx.auditLog.create({
      data: {
        adminUserId: actorId,
        action: ADMIN_AUDIT_ACTIONS.invited,
        entityType: AUDIT_ENTITY_ADMIN_INVITATION,
        entityId: invitation.id,
        metadata: { email: parsed.data.email, role: INVITED_ROLE },
      },
    });
    return invitation;
  });
  if (!created) return { ok: false, error: "ALREADY_ADMIN" };

  const url = new URL(ADMIN_INVITE_PATH, siteUrl);
  url.searchParams.set("token", rawToken);
  try {
    await email.send(
      invitationEmail({
        to: parsed.data.email,
        name: parsed.data.name,
        inviterName: created.invitedBy.name,
        url: url.toString(),
        expiresAt,
      }),
    );
  } catch {
    await db.adminInvitation.update({
      where: { id: created.id },
      data: { revokedAt: new Date() },
    });
    return { ok: false, error: "EMAIL_FAILED" };
  }
  return { ok: true, invitationId: created.id, expiresAt };
}

export type OpenInvitation = {
  id: string;
  email: string;
  name: string;
  expiresAt: Date;
};

/**
 * Looks up a usable invitation by its raw token: not accepted, not revoked
 * and not expired. Returns null for anything else, without saying why.
 */
export async function findUsableInvitation(
  db: PrismaClient,
  token: unknown,
  now: Date = new Date(),
): Promise<OpenInvitation | null> {
  if (typeof token !== "string" || !isWellFormedToken(token)) return null;
  return db.adminInvitation.findFirst({
    where: {
      tokenHash: hashToken(token),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, email: true, name: true, expiresAt: true },
  });
}

export type AcceptInvitationResult =
  | { ok: true; adminUserId: string; email: string }
  | {
      ok: false;
      error: "INVALID_TOKEN" | "INVALID_PASSWORD";
      message?: string;
    };

/**
 * Accepts an invitation: creates the administrator with the invitation's own
 * email and role, stores the password as a Better Auth credential and marks
 * the invitation used, all in one transaction. The conditional update makes
 * the token single-use even under concurrent submissions.
 *
 * `hashPassword` is Better Auth's password hasher (`ctx.password.hash`).
 */
export async function acceptInvitation(
  db: PrismaClient,
  {
    token,
    password,
    hashPassword,
    now = new Date(),
  }: {
    token: unknown;
    password: unknown;
    hashPassword: (password: string) => Promise<string>;
    now?: Date;
  },
): Promise<AcceptInvitationResult> {
  const invitation = await findUsableInvitation(db, token, now);
  if (!invitation) return { ok: false, error: "INVALID_TOKEN" };

  const parsedPassword = adminPasswordSchema.safeParse(password);
  if (!parsedPassword.success) {
    return {
      ok: false,
      error: "INVALID_PASSWORD",
      message: parsedPassword.error.issues[0]?.message,
    };
  }
  // Hash before opening the transaction: scrypt is deliberately slow.
  const passwordHash = await hashPassword(parsedPassword.data);

  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.adminInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
        select: { email: true, name: true, role: true },
      });
      const existing = await tx.adminUser.findUnique({
        where: { email: row.email },
        select: { id: true },
      });
      if (existing) {
        // The address became an administrator another way after the
        // invitation was sent. Retire the invitation.
        await tx.adminInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        return { ok: false, error: "INVALID_TOKEN" } as const;
      }

      const admin = await tx.adminUser.create({
        data: {
          name: row.name,
          email: row.email,
          role: row.role,
          isActive: true,
          // Opening the emailed link proves control of the mailbox.
          emailVerified: true,
        },
        select: { id: true, email: true },
      });
      await tx.adminAccount.create({
        data: {
          userId: admin.id,
          providerId: "credential",
          accountId: admin.id,
          password: passwordHash,
        },
      });
      // Conditional claim: exactly one submission can mark the invitation
      // used. A concurrent or repeated one matches no row and rolls back.
      const claimed = await tx.adminInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now, acceptedById: admin.id },
      });
      if (claimed.count !== 1) throw new InvitationUnavailableError();

      await tx.auditLog.create({
        data: {
          adminUserId: admin.id,
          action: ADMIN_AUDIT_ACTIONS.invitationAccepted,
          entityType: AUDIT_ENTITY_ADMIN_INVITATION,
          entityId: invitation.id,
          metadata: { email: admin.email, role: row.role },
        },
      });
      return { ok: true, adminUserId: admin.id, email: admin.email } as const;
    });
  } catch (error) {
    // Lost a race: another submission claimed the invitation or created the
    // administrator (unique email) first.
    if (
      error instanceof InvitationUnavailableError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002")
    ) {
      return { ok: false, error: "INVALID_TOKEN" };
    }
    throw error;
  }
}

/** Revokes an open invitation (OWNER only). */
export async function revokeInvitation(
  db: PrismaClient,
  {
    actorId,
    invitationId,
    now = new Date(),
  }: { actorId: string; invitationId: string; now?: Date },
): Promise<{ ok: boolean }> {
  return db.$transaction(async (tx) => {
    await assertActingOwner(tx, actorId);
    const revoked = await tx.adminInvitation.updateMany({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) return { ok: false };
    await tx.auditLog.create({
      data: {
        adminUserId: actorId,
        action: ADMIN_AUDIT_ACTIONS.invitationRevoked,
        entityType: AUDIT_ENTITY_ADMIN_INVITATION,
        entityId: invitationId,
        metadata: {},
      },
    });
    return { ok: true };
  });
}

/** Open (unaccepted, unrevoked) invitations, including expired ones. */
export async function listOpenInvitations(db: PrismaClient) {
  return db.adminInvitation.findMany({
    where: { acceptedAt: null, revokedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
