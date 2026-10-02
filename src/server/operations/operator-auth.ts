import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Authenticates the OWNER running an operator command (scripts/operator.ts)
 * with their admin password, verified by Better Auth's own hasher, so every
 * operator action is attributable to a real, active OWNER in the audit log.
 * Returns the administrator's ID, or null for any failure (unknown email,
 * wrong password, inactive, not an OWNER), without saying which.
 */
export async function authenticateOwner(
  db: PrismaClient,
  {
    email,
    password,
    verifyPassword,
  }: {
    email: string;
    password: string;
    verifyPassword: (input: {
      hash: string;
      password: string;
    }) => Promise<boolean>;
  },
): Promise<string | null> {
  const admin = await db.adminUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      role: true,
      isActive: true,
      accounts: {
        where: { providerId: "credential" },
        select: { password: true },
      },
    },
  });
  const hash = admin?.accounts[0]?.password;
  // The CLI is not reachable from the network, so response timing for
  // unknown accounts is not a concern here.
  if (!admin || !hash) return null;
  const valid = await verifyPassword({ hash, password });
  if (!valid || !admin.isActive || admin.role !== "OWNER") return null;
  return admin.id;
}
