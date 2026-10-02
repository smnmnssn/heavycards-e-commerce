import type {
  AdminRole,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/authorization";

import { UUID_PATTERN } from "./catalog/shared";

type Queryable = PrismaClient | Prisma.TransactionClient;
export type AdminRule = (admin: { role: AdminRole }) => boolean;

/*
 * Database-side re-checks of the acting administrator for the Milestone 12
 * order, review, dashboard and settings services. Pages and actions check
 * the session first (src/lib/auth/session.ts); these checks catch an
 * account deactivated or demoted since, and make the services safe to call
 * on their own (the DB tests do).
 */

type ActorRow = { role: AdminRole; isActive: boolean };

function assertAllowed(
  actor: ActorRow | undefined,
  rule: AdminRule,
  message: string,
) {
  if (!actor?.isActive || !rule(actor)) throw new ForbiddenError(message);
}

/**
 * For reads (orders hold customer data): the actor must exist, be active
 * and satisfy `rule`. Throws ForbiddenError otherwise.
 */
export async function assertActiveAdmin(
  client: Queryable,
  actorId: string,
  rule: AdminRule,
  message = "Behörighet saknas.",
): Promise<void> {
  if (!UUID_PATTERN.test(actorId)) throw new ForbiddenError(message);
  const [actor] = await client.$queryRaw<ActorRow[]>`
    SELECT role::text AS role, is_active AS "isActive"
    FROM admin_users WHERE id = ${actorId}::uuid`;
  assertAllowed(actor, rule, message);
}

/**
 * For writes, inside the write transaction: like assertActiveAdmin, and
 * `FOR SHARE` keeps the account from being deactivated until it commits.
 */
export async function lockActiveAdmin(
  tx: Prisma.TransactionClient,
  actorId: string,
  rule: AdminRule,
  message = "Behörighet saknas.",
): Promise<void> {
  if (!UUID_PATTERN.test(actorId)) throw new ForbiddenError(message);
  const [actor] = await tx.$queryRaw<ActorRow[]>`
    SELECT role::text AS role, is_active AS "isActive"
    FROM admin_users WHERE id = ${actorId}::uuid
    FOR SHARE`;
  assertAllowed(actor, rule, message);
}
