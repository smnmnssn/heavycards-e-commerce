import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/authorization";

import { ADMIN_AUDIT_ACTIONS, AUDIT_ENTITY_ADMIN_USER } from "./audit";

type Tx = Prisma.TransactionClient;

/**
 * Locks every active OWNER row for the rest of the transaction and returns
 * their ids. Concurrent owner-affecting changes therefore run one at a time,
 * and each sees the committed result of the previous one, so two owners can
 * never deactivate each other simultaneously and leave the store without one.
 */
async function lockActiveOwnerIds(tx: Tx): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM admin_users
    WHERE role = 'OWNER' AND is_active
    ORDER BY id
    FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

/**
 * Loads the acting administrator inside the transaction and requires an
 * active OWNER. The session check in the server action is not enough on its
 * own: the role or status may have changed since the session was read.
 */
export async function assertActingOwner(tx: Tx, actorId: string) {
  const activeOwnerIds = await lockActiveOwnerIds(tx);
  if (!activeOwnerIds.includes(actorId)) {
    throw new ForbiddenError("Endast ägare (OWNER) har behörighet.");
  }
  return { activeOwnerIds };
}

/**
 * True if `targetId` is the only active OWNER. Every change that deactivates,
 * removes or demotes an administrator must check this first (with the owner
 * rows locked, see lockActiveOwnerIds).
 */
export function isLastActiveOwner(activeOwnerIds: string[], targetId: string) {
  return (
    activeOwnerIds.includes(targetId) &&
    activeOwnerIds.every((id) => id === targetId)
  );
}

export type SetAdminActiveResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: "NOT_FOUND" | "LAST_OWNER" | "SELF" };

/**
 * Activates or deactivates an administrator (OWNER only).
 *
 * Deactivation takes effect immediately: the account's sessions and pending
 * password-reset values are deleted in the same transaction, and sign-in is
 * refused while isActive is false.
 */
export async function setAdminActive(
  db: PrismaClient,
  {
    actorId,
    targetId,
    active,
  }: { actorId: string; targetId: string; active: boolean },
): Promise<SetAdminActiveResult> {
  return db.$transaction(async (tx) => {
    const { activeOwnerIds } = await assertActingOwner(tx, actorId);

    const target = await tx.adminUser.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!target) return { ok: false, error: "NOT_FOUND" };
    if (!active && isLastActiveOwner(activeOwnerIds, target.id)) {
      return { ok: false, error: "LAST_OWNER" };
    }
    // Owners cannot lock themselves out; another OWNER must do it.
    if (target.id === actorId) return { ok: false, error: "SELF" };
    if (target.isActive === active) return { ok: true, changed: false };

    await tx.adminUser.update({
      where: { id: target.id },
      data: { isActive: active },
    });
    if (!active) {
      await tx.adminSession.deleteMany({ where: { userId: target.id } });
      // Reset values store the user id as their value; identifiers are hashed.
      await tx.authVerification.deleteMany({ where: { value: target.id } });
    }
    await tx.auditLog.create({
      data: {
        adminUserId: actorId,
        action: active
          ? ADMIN_AUDIT_ACTIONS.reactivated
          : ADMIN_AUDIT_ACTIONS.deactivated,
        entityType: AUDIT_ENTITY_ADMIN_USER,
        entityId: target.id,
        metadata: { email: target.email, role: target.role },
      },
    });
    return { ok: true, changed: true };
  });
}

export type AdminListEntry = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN";
  isActive: boolean;
  createdAt: Date;
};

export async function listAdmins(db: PrismaClient): Promise<AdminListEntry[]> {
  return db.adminUser.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}
