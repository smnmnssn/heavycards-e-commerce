import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { canManageOrders } from "@/lib/auth/authorization";

import { assertActiveAdmin } from "./access";
import { listAdminProducts, type AdminProductRow } from "./catalog/queries";
import { UUID_PATTERN } from "./catalog/shared";
import { openAttentionSql } from "./orders/attention";
import { parseAdminOrderParams } from "./orders/list-params";
import { listAdminOrders, type AdminOrderRow } from "./orders/queries";
import { ATTENTION_ACTIONS } from "./orders/presenters";

/*
 * The /admin overview (PROJECT.md §52): operational counts first, a small
 * sales summary, and the latest orders and order events. Every number is
 * one aggregate query (COUNT/SUM with FILTER) over indexed columns, run in
 * parallel; nothing loads whole tables, and the lists are bounded.
 */

export const SALES_WINDOW_DAYS = 30;
/** A due email not attempted within this time means the scheduler is idle. */
export const EMAIL_OVERDUE_MS = 30 * 60 * 1000;

export type DashboardAttentionItem = {
  id: string;
  orderId: string;
  orderNumber: number;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
};

export type DashboardEvent = {
  id: string;
  orderId: string;
  orderNumber: number | null;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actorName: string | null;
};

export type AdminDashboard = {
  orders: {
    /** Paid, not started (NEW). */
    toStart: number;
    /** Paid, being handled, not shipped yet (PROCESSING). */
    processing: number;
    /** Fully refunded before shipping: to be cancelled. */
    refundedOpen: number;
  };
  attention: {
    orders: number;
    payment: number;
    email: number;
    stock: number;
    latest: DashboardAttentionItem[];
  };
  pendingReviews: number;
  lowStock: { total: number; rows: AdminProductRow[] };
  emails: { retrying: number; overdue: number };
  /**
   * Orders paid in the last SALES_WINDOW_DAYS days (PAID, PARTIALLY_REFUNDED
   * and REFUNDED), by payment time. Amounts include VAT and shipping;
   * `netAmount` subtracts what has been refunded on those orders so far.
   */
  sales: {
    since: Date;
    orders: number;
    grossAmount: number;
    refundedAmount: number;
    netAmount: number;
  };
  recentOrders: AdminOrderRow[];
  recentEvents: DashboardEvent[];
};

export async function getAdminDashboard(
  db: PrismaClient,
  {
    actorId,
    lowStockThreshold,
    now,
  }: { actorId: string; lowStockThreshold: number; now: Date },
): Promise<AdminDashboard> {
  await assertActiveAdmin(
    db,
    actorId,
    canManageOrders,
    "Behörighet saknas för översikten.",
  );
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 86_400_000);
  const overdueBefore = new Date(now.getTime() - EMAIL_OVERDUE_MS);

  const [
    [orders],
    [attention],
    latestAttention,
    pendingReviews,
    lowStock,
    [emails],
    [sales],
    recentOrders,
    events,
  ] = await Promise.all([
    db.$queryRaw<[AdminDashboard["orders"]]>`
      SELECT
        count(*) FILTER (WHERE payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
                           AND fulfillment_status = 'NEW')::int AS "toStart",
        count(*) FILTER (WHERE payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
                           AND fulfillment_status = 'PROCESSING')::int AS processing,
        count(*) FILTER (WHERE payment_status = 'REFUNDED')::int AS "refundedOpen"
      FROM orders
      WHERE fulfillment_status IN ('NEW', 'PROCESSING')`,
    db.$queryRaw<[Omit<AdminDashboard["attention"], "latest">]>`
      SELECT
        count(DISTINCT a.entity_id)::int AS orders,
        count(*) FILTER (WHERE a.action = ${ATTENTION_ACTIONS.payment})::int AS payment,
        count(*) FILTER (WHERE a.action = ${ATTENTION_ACTIONS.email})::int AS email,
        count(*) FILTER (WHERE a.action = ${ATTENTION_ACTIONS.paidWithShortfall})::int AS stock
      FROM audit_logs a
      WHERE ${openAttentionSql(now)}`,
    // Materialized first, so only Order entries (UUID entity IDs) are cast.
    db.$queryRaw<DashboardAttentionItem[]>`
      WITH open AS MATERIALIZED (
        SELECT a.id, a.entity_id, a.action, a.metadata, a.created_at
        FROM audit_logs a
        WHERE ${openAttentionSql(now)}
        ORDER BY a.created_at DESC
        LIMIT 10
      )
      SELECT open.id::text AS id, open.entity_id AS "orderId",
             o.order_number AS "orderNumber", open.action, open.metadata,
             open.created_at AS "createdAt"
      FROM open
      JOIN orders o ON o.id = open.entity_id::uuid
      ORDER BY open.created_at DESC`,
    db.review.count({ where: { status: "PENDING" } }),
    listAdminProducts(db, {
      params: {
        q: "",
        status: "publicerade",
        categoryId: "",
        setId: "",
        stock: "lagt",
        sort: "lager",
        page: 1,
      },
      lowStockThreshold,
      now,
      pageSize: 5,
    }),
    db.$queryRaw<[AdminDashboard["emails"]]>`
      SELECT
        count(*) FILTER (WHERE attempts > 0)::int AS retrying,
        count(*) FILTER (WHERE next_attempt_at < ${overdueBefore})::int AS overdue
      FROM email_deliveries
      WHERE status = 'PENDING'`,
    db.$queryRaw<[{ orders: number; gross: string; refunded: string }]>`
      SELECT count(*)::int AS orders,
             COALESCE(SUM(total_amount), 0)::text AS gross,
             COALESCE(SUM(refunded_amount), 0)::text AS refunded
      FROM orders
      WHERE payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND paid_at >= ${since}`,
    listAdminOrders(db, {
      actorId,
      params: parseAdminOrderParams({}),
      pageSize: 8,
      now,
    }),
    db.auditLog.findMany({
      where: { entityType: "Order" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        entityId: true,
        action: true,
        metadata: true,
        createdAt: true,
        adminUser: { select: { name: true } },
      },
    }),
  ]);

  // One query for the order numbers of all listed events (no N+1).
  const eventOrderIds = [
    ...new Set(events.map((event) => event.entityId)),
  ].filter((id) => UUID_PATTERN.test(id));
  const eventOrders = await db.order.findMany({
    where: { id: { in: eventOrderIds } },
    select: { id: true, orderNumber: true },
  });
  const numbers = new Map(eventOrders.map((o) => [o.id, o.orderNumber]));

  // Sums are bigint in SQL; öre totals stay far below 2^53.
  const grossAmount = Number(BigInt(sales.gross));
  const refundedAmount = Number(BigInt(sales.refunded));

  return {
    orders,
    attention: { ...attention, latest: latestAttention },
    pendingReviews,
    lowStock: { total: lowStock.total, rows: lowStock.rows },
    emails,
    sales: {
      since,
      orders: sales.orders,
      grossAmount,
      refundedAmount,
      netAmount: grossAmount - refundedAmount,
    },
    recentOrders: recentOrders.rows,
    recentEvents: events.map((event) => ({
      id: event.id,
      orderId: event.entityId,
      orderNumber: numbers.get(event.entityId) ?? null,
      action: event.action,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actorName: event.adminUser?.name ?? null,
    })),
  };
}
