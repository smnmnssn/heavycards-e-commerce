import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  adminEmailSchema,
  adminNameSchema,
  adminPasswordSchema,
} from "@/lib/validation/admin";

import { ADMIN_AUDIT_ACTIONS, AUDIT_ENTITY_ADMIN_USER } from "./audit";

/** Arbitrary constant key that serialises concurrent bootstrap runs. */
const BOOTSTRAP_LOCK_KEY = 482_017_306;

const bootstrapSchema = z.object({
  name: adminNameSchema,
  email: adminEmailSchema,
  password: adminPasswordSchema,
});

export type BootstrapOwnerResult =
  | { ok: true; adminUserId: string; email: string }
  | {
      ok: false;
      error: "INVALID_INPUT" | "OWNER_EXISTS" | "EMAIL_EXISTS";
      message: string;
    };

/**
 * Creates the first OWNER with a Better Auth credential. Refuses when any
 * active OWNER already exists (further administrators are invited from the
 * admin UI) or when the email already belongs to an administrator.
 *
 * `hashPassword` must be Better Auth's password hasher, so the bootstrap
 * credential is stored exactly like every other password.
 */
export async function bootstrapOwner(
  db: PrismaClient,
  {
    name,
    email,
    password,
    hashPassword,
  }: {
    name: unknown;
    email: unknown;
    password: unknown;
    hashPassword: (password: string) => Promise<string>;
  },
): Promise<BootstrapOwnerResult> {
  const parsed = bootstrapSchema.safeParse({ name, email, password });
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter.",
    };
  }
  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

    const activeOwners = await tx.adminUser.count({
      where: { role: "OWNER", isActive: true },
    });
    if (activeOwners > 0) {
      return {
        ok: false,
        error: "OWNER_EXISTS",
        message:
          "Det finns redan en aktiv ägare (OWNER). Bjud in fler administratörer från adminpanelen.",
      };
    }
    const existing = await tx.adminUser.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: "EMAIL_EXISTS",
        message: "E-postadressen tillhör redan en administratör.",
      };
    }

    const owner = await tx.adminUser.create({
      data: {
        name: input.name,
        email: input.email,
        role: "OWNER",
        isActive: true,
        emailVerified: true,
      },
      select: { id: true, email: true },
    });
    await tx.adminAccount.create({
      data: {
        userId: owner.id,
        providerId: "credential",
        accountId: owner.id,
        password: passwordHash,
      },
    });
    await tx.auditLog.create({
      data: {
        adminUserId: owner.id,
        action: ADMIN_AUDIT_ACTIONS.ownerBootstrapped,
        entityType: AUDIT_ENTITY_ADMIN_USER,
        entityId: owner.id,
        metadata: { email: owner.email, method: "cli" },
      },
    });
    return { ok: true, adminUserId: owner.id, email: owner.email };
  });
}
