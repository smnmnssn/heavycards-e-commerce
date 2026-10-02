import {
  Prisma,
  type EmailDeliveryStatus,
  type EmailKind,
  type FulfillmentStatus,
  type PaymentStatus,
  type PrismaClient,
  type ReviewStatus,
  type ShippingCarrier,
} from "@/generated/prisma/client";
import { canManageOrders } from "@/lib/auth/authorization";
import { siteConfig } from "@/lib/config/site";
import { holdingReservationWhere } from "@/server/data/reservations";

import { assertActiveAdmin } from "../access";
import { openAttentionSql } from "./attention";
import {
  ADMIN_ORDERS_PAGE_SIZE,
  fulfillmentStatusesFor,
  parseOrderSearch,
  paymentStatusesFor,
  type AdminOrderListParams,
  type OrderSort,
} from "./list-params";

/*
 * Read queries for /admin/orders. Orders hold customer data, so every query
 * first re-checks the acting administrator in the database (active, may
 * manage orders). Like the catalog queries they take the Prisma client
 * explicitly, so the DB tests run exactly this code.
 *
 * Historical values come only from the order and its item snapshots, never
 * from the current product.
 */

const FORBIDDEN = "Behörighet saknas för beställningar.";

// --- List --------------------------------------------------------------------------

export type AdminOrderRow = {
  id: string;
  orderNumber: number;
  createdAt: Date;
  paidAt: Date | null;
  /** Only the name: the list shows no email, phone or address. */
  customerName: string | null;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalAmount: number;
  refundedAmount: number;
  units: number;
  openAttention: number;
};

export type AdminOrderList = {
  rows: AdminOrderRow[];
  total: number;
  page: number;
  pageCount: number;
};

const likePattern = (term: string) =>
  `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const ORDER_BY: Record<OrderSort, Prisma.Sql> = {
  nyast: Prisma.sql`o.created_at DESC, o.id DESC`,
  aldst: Prisma.sql`o.created_at ASC, o.id ASC`,
  belopp: Prisma.sql`o.total_amount DESC, o.created_at DESC, o.id DESC`,
};

/** WHERE clause of the order list (exported for the dashboard's counts). */
export function orderListWhere(
  params: AdminOrderListParams,
  now: Date,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  const payments = paymentStatusesFor(params.payment, params.attention);
  if (payments) {
    conditions.push(
      Prisma.sql`o.payment_status::text IN (${Prisma.join([...payments])})`,
    );
  }
  const fulfillments = fulfillmentStatusesFor(params.fulfillment);
  if (fulfillments) {
    conditions.push(
      Prisma.sql`o.fulfillment_status::text IN (${Prisma.join([...fulfillments])})`,
    );
  }
  if (params.attention) {
    conditions.push(Prisma.sql`o.id::text IN (
      SELECT a.entity_id FROM audit_logs a WHERE ${openAttentionSql(now)})`);
  }
  // Calendar days in Stockholm, inclusive on both ends.
  const zone = siteConfig.timeZone;
  if (params.from) {
    conditions.push(
      Prisma.sql`o.created_at >= (${params.from}::date::timestamp AT TIME ZONE ${zone})`,
    );
  }
  if (params.to) {
    conditions.push(
      Prisma.sql`o.created_at < ((${params.to}::date + 1)::timestamp AT TIME ZONE ${zone})`,
    );
  }
  const search = parseOrderSearch(params.q);
  switch (search.kind) {
    case "orderNumber":
      conditions.push(Prisma.sql`o.order_number = ${search.orderNumber}`);
      break;
    case "stripeId":
      conditions.push(
        Prisma.sql`(o.stripe_checkout_session_id = ${search.id} OR o.stripe_payment_intent_id = ${search.id})`,
      );
      break;
    case "text":
      for (const term of search.terms) {
        const pattern = likePattern(term);
        conditions.push(
          Prisma.sql`(lower(o.email) LIKE ${pattern} ESCAPE '\\' OR lower(o.customer_name) LIKE ${pattern} ESCAPE '\\')`,
        );
      }
      break;
    case "none":
      break;
  }
  return Prisma.join(conditions, " AND ");
}

type ListRow = AdminOrderRow & { totalCount: number };

/**
 * One page of orders in a single query. The page's IDs and the total
 * (`count(*) OVER ()`) are chosen first; only those rows then get their
 * units and number of open attention items (lateral lookups through
 * indexes), so the cost does not grow with the number of matching orders.
 */
export async function listAdminOrders(
  client: PrismaClient,
  {
    actorId,
    params,
    pageSize = ADMIN_ORDERS_PAGE_SIZE,
    now = new Date(),
  }: {
    actorId: string;
    params: AdminOrderListParams;
    pageSize?: number;
    now?: Date;
  },
): Promise<AdminOrderList> {
  await assertActiveAdmin(client, actorId, canManageOrders, FORBIDDEN);
  const where = orderListWhere(params, now);

  const fetchPage = (page: number) => client.$queryRaw<ListRow[]>`
    WITH page_ids AS (
      SELECT o.id, count(*) OVER ()::int AS total_count
      FROM orders o
      WHERE ${where}
      ORDER BY ${ORDER_BY[params.sort]}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    )
    SELECT
      o.id::text AS id,
      o.order_number AS "orderNumber",
      o.created_at AS "createdAt",
      o.paid_at AS "paidAt",
      o.customer_name AS "customerName",
      o.payment_status::text AS "paymentStatus",
      o.fulfillment_status::text AS "fulfillmentStatus",
      o.total_amount AS "totalAmount",
      o.refunded_amount AS "refundedAmount",
      items.units,
      attention.open AS "openAttention",
      page_ids.total_count AS "totalCount"
    FROM page_ids
    JOIN orders o ON o.id = page_ids.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(i.quantity), 0)::int AS units
      FROM order_items i WHERE i.order_id = o.id
    ) items ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS open
      FROM audit_logs a
      WHERE a.entity_id = o.id::text AND ${openAttentionSql(now)}
    ) attention ON TRUE
    ORDER BY ${ORDER_BY[params.sort]}`;

  let page = params.page;
  let rows = await fetchPage(page);
  // A page past the end (e.g. after filtering) falls back to the last page.
  if (rows.length === 0 && page > 1) {
    const [{ total }] = await client.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total FROM orders o WHERE ${where}`;
    page = Math.max(1, Math.ceil(total / pageSize));
    rows = total > 0 ? await fetchPage(page) : [];
  }
  const total = rows[0]?.totalCount ?? 0;
  return {
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    rows,
  };
}

// --- Detail ------------------------------------------------------------------------

export type AdminOrderAttention = {
  id: string;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
};

export type AdminOrderEvent = {
  id: string;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  /** Null for system entries (Stripe webhooks, the email outbox). */
  actorName: string | null;
};

export type AdminOrderDetail = {
  id: string;
  orderNumber: number;
  createdAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  refundedAmount: number;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  checkoutExpiresAt: Date | null;
  shippingCarrier: ShippingCarrier | null;
  trackingNumber: string | null;
  confirmationEmailSentAt: Date | null;
  shippingEmailSentAt: Date | null;
  items: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    skuSnapshot: string;
    quantity: number;
    unitPriceAmount: number;
    totalPriceAmount: number;
    vatRateBasisPoints: number;
    review: { id: string; status: ReviewStatus; rating: number } | null;
  }>;
  emails: Array<{
    id: string;
    kind: EmailKind;
    status: EmailDeliveryStatus;
    attempts: number;
    lastAttemptAt: Date | null;
    nextAttemptAt: Date;
    sentAt: Date | null;
    lastError: string | null;
    providerMessageId: string | null;
  }>;
  /** The review invitation's dates only; its token never leaves the server. */
  reviewInvitation: {
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null;
  /** Units still held for this order (a checkout in progress). */
  heldUnits: number;
  attention: AdminOrderAttention[];
  events: AdminOrderEvent[];
};

/** At most this many audit entries are shown on one order. */
export const ORDER_EVENTS_LIMIT = 200;

export async function getAdminOrder(
  client: PrismaClient,
  { actorId, orderId, now }: { actorId: string; orderId: string; now: Date },
): Promise<AdminOrderDetail | null> {
  await assertActiveAdmin(client, actorId, canManageOrders, FORBIDDEN);
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          review: { select: { id: true, status: true, rating: true } },
        },
      },
      emailDeliveries: { orderBy: { createdAt: "asc" } },
      reviewToken: {
        select: { createdAt: true, expiresAt: true, revokedAt: true },
      },
    },
  });
  if (!order) return null;

  const [held, events, attention] = await Promise.all([
    client.inventoryReservation.aggregate({
      where: { orderId, ...holdingReservationWhere(now) },
      _sum: { quantity: true },
    }),
    client.auditLog.findMany({
      where: { entityType: "Order", entityId: orderId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ORDER_EVENTS_LIMIT,
      select: {
        id: true,
        action: true,
        metadata: true,
        createdAt: true,
        adminUser: { select: { name: true } },
      },
    }),
    client.$queryRaw<AdminOrderAttention[]>`
      SELECT a.id::text AS id, a.action, a.metadata, a.created_at AS "createdAt"
      FROM audit_logs a
      WHERE a.entity_id = ${orderId} AND ${openAttentionSql(now)}
      ORDER BY a.created_at ASC`,
  ]);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    postalCode: order.postalCode,
    city: order.city,
    country: order.country,
    subtotalAmount: order.subtotalAmount,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    refundedAmount: order.refundedAmount,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    checkoutExpiresAt: order.checkoutExpiresAt,
    shippingCarrier: order.shippingCarrier,
    trackingNumber: order.trackingNumber,
    confirmationEmailSentAt: order.confirmationEmailSentAt,
    shippingEmailSentAt: order.shippingEmailSentAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      skuSnapshot: item.skuSnapshot,
      quantity: item.quantity,
      unitPriceAmount: item.unitPriceAmount,
      totalPriceAmount: item.totalPriceAmount,
      vatRateBasisPoints: item.vatRateBasisPoints,
      review: item.review,
    })),
    emails: order.emailDeliveries.map((delivery) => ({
      id: delivery.id,
      kind: delivery.kind,
      status: delivery.status,
      attempts: delivery.attempts,
      lastAttemptAt: delivery.lastAttemptAt,
      nextAttemptAt: delivery.nextAttemptAt,
      sentAt: delivery.sentAt,
      lastError: delivery.lastError,
      providerMessageId: delivery.providerMessageId,
    })),
    reviewInvitation: order.reviewToken,
    heldUnits: held._sum.quantity ?? 0,
    attention,
    events: events.map(({ adminUser, ...event }) => ({
      ...event,
      actorName: adminUser?.name ?? null,
    })),
  };
}
