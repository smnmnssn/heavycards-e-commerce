import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { canManageOrders } from "@/lib/auth/authorization";
import {
  holdingReservationSql,
  holdingReservationWhere,
} from "@/server/data/reservations";
import { withTransactionRetry } from "@/server/db/transactions";

import { lockActiveAdmin } from "../access";
import {
  ATTENTION_ACTIONS,
  describeAttention,
  isAttentionEntry,
} from "./presenters";

/*
 * "Needs attention" items (PROJECT.md §32, §86; Milestones 9–10). Earlier
 * milestones record operational problems as system audit entries instead of
 * corrupting data:
 * - PAYMENT_NEEDS_ATTENTION: Stripe and HeavyCards disagree; the order was
 *   left unpaid;
 * - EMAIL_NEEDS_ATTENTION: automatic delivery of an order email stopped
 *   (the delivery is FAILED);
 * - MARK_ORDER_PAID with `stockShortfalls`: paid, but stock had been
 *   lowered below the reservation.
 *
 * Acknowledgement vs. an active condition. An administrator may mark an
 * item handled (an appended RESOLVE_ORDER_ATTENTION entry; nothing else
 * changes, and the audit log stays append-only) only when it no longer
 * describes an unsafe state. A payment problem whose order still holds
 * stock (an ACTIVE reservation awaiting Stripe's outcome, Milestone 9) is
 * such a state: it blocks inventory until Stripe gives a safe answer, so
 * - it cannot be marked handled (`STILL_BLOCKING`);
 * - it stays open even if a resolution exists (e.g. written before this
 *   rule), for as long as the hold lasts;
 * - the only way out is the condition becoming safe: "Kontrollera med
 *   Stripe igen" (./payment-recheck.ts) lets the existing payment service
 *   finalize or release the order from Stripe's authoritative state.
 * Admin clicks never release stock.
 */

export const ORDER_ATTENTION_AUDIT_ACTIONS = {
  resolved: "RESOLVE_ORDER_ATTENTION",
} as const;

/**
 * SQL condition: the audit row aliased `a` is an open attention item at
 * `now`. Uses the (action, created_at) index; resolutions are found through
 * the (entity_type, entity_id, created_at) index and holds through the
 * reservations' (order_id, product_id) index.
 */
export function openAttentionSql(now: Date): Prisma.Sql {
  return Prisma.sql`
  a.entity_type = 'Order'
  AND (
    a.action IN (${ATTENTION_ACTIONS.payment}, ${ATTENTION_ACTIONS.email})
    OR (
      a.action = ${ATTENTION_ACTIONS.paidWithShortfall}
      AND jsonb_typeof(a.metadata -> 'stockShortfalls') = 'array'
    )
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM audit_logs res
      WHERE res.entity_type = 'Order'
        AND res.entity_id = a.entity_id
        AND res.action = ${ORDER_ATTENTION_AUDIT_ACTIONS.resolved}
        AND res.metadata ->> 'attentionId' = a.id::text
    )
    OR (
      a.action = ${ATTENTION_ACTIONS.payment}
      AND EXISTS (
        SELECT 1 FROM inventory_reservations r
        -- CASE: the cast only ever sees Order entity IDs (UUIDs).
        WHERE r.order_id = (CASE WHEN a.entity_type = 'Order'
                                 THEN a.entity_id::uuid END)
          AND ${holdingReservationSql(now)}
      )
    )
  )`;
}

/**
 * Whether an attention entry describes an active unsafe condition: a
 * payment problem of an order that still holds stock.
 */
export function attentionBlocksStock(
  action: string,
  order: { heldUnits: number },
): boolean {
  return action === ATTENTION_ACTIONS.payment && order.heldUnits > 0;
}

const resolveInputSchema = z.object({
  orderId: z.uuid(),
  attentionId: z.uuid(),
});

export type ResolveAttentionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: "INVALID_INPUT" | "NOT_FOUND" }
  /** A payment problem whose order still holds stock: not acknowledgeable. */
  | { ok: false; error: "STILL_BLOCKING"; heldUnits: number };

/**
 * Marks one attention item of an order as handled. `input` is untrusted.
 * Throws ForbiddenError when the actor may not manage orders. Repeating it
 * is a no-op: the order row lock serialises concurrent clicks, so at most
 * one resolution entry exists per item. A payment problem is refused while
 * its order holds stock; the check runs under the same order row lock the
 * payment service takes before it consumes or releases reservations.
 */
export async function resolveOrderAttention(
  db: PrismaClient,
  {
    actorId,
    input,
    now = new Date(),
  }: { actorId: string; input: unknown; now?: Date },
): Promise<ResolveAttentionResult> {
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { orderId, attentionId } = parsed.data;

  return withTransactionRetry(() =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await lockActiveAdmin(
          tx,
          actorId,
          canManageOrders,
          "Behörighet saknas för beställningar.",
        );
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM orders WHERE id = ${orderId}::uuid
          FOR UPDATE`;
        if (locked.length === 0) {
          return { ok: false, error: "NOT_FOUND" } as const;
        }

        const entry = await tx.auditLog.findFirst({
          where: { id: attentionId, entityType: "Order", entityId: orderId },
          select: { action: true, metadata: true },
        });
        if (!entry || !isAttentionEntry(entry.action, entry.metadata)) {
          return { ok: false, error: "NOT_FOUND" } as const;
        }
        if (entry.action === ATTENTION_ACTIONS.payment) {
          const held = await tx.inventoryReservation.aggregate({
            where: { orderId, ...holdingReservationWhere(now) },
            _sum: { quantity: true },
          });
          const heldUnits = held._sum.quantity ?? 0;
          if (attentionBlocksStock(entry.action, { heldUnits })) {
            return { ok: false, error: "STILL_BLOCKING", heldUnits } as const;
          }
        }
        const existing = await tx.auditLog.findFirst({
          where: {
            action: ORDER_ATTENTION_AUDIT_ACTIONS.resolved,
            entityType: "Order",
            entityId: orderId,
            metadata: { path: ["attentionId"], equals: attentionId },
          },
          select: { id: true },
        });
        if (existing) return { ok: true, changed: false } as const;

        await tx.auditLog.create({
          data: {
            adminUserId: actorId,
            action: ORDER_ATTENTION_AUDIT_ACTIONS.resolved,
            entityType: "Order",
            entityId: orderId,
            metadata: {
              attentionId,
              kind: describeAttention(entry.action, entry.metadata).kind,
            },
          },
        });
        return { ok: true, changed: true } as const;
      },
      { maxWait: 10_000, timeout: 20_000 },
    ),
  );
}
