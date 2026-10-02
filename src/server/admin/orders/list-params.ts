import { z } from "zod";

import type {
  FulfillmentStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";
import type { IsoDate } from "@/lib/dates";

/*
 * Query parameters of /admin/orders. Parsed leniently like the product list:
 * an invalid value is ignored rather than rejected.
 */

export const ADMIN_ORDERS_PAGE_SIZE = 50;

export const ORDER_PAYMENT_FILTERS = {
  "": "Alla utom avbrutna kassor",
  betalda: "Betalda (inkl. delvis återbetalda)",
  PAID: "Betald",
  PARTIALLY_REFUNDED: "Delvis återbetald",
  REFUNDED: "Återbetald",
  PENDING: "Väntar på betalning",
  FAILED: "Betalning misslyckades",
  EXPIRED: "Avbruten kassa",
  alla: "Alla",
} as const;
export type OrderPaymentFilter = keyof typeof ORDER_PAYMENT_FILTERS;

export const ORDER_FULFILLMENT_FILTERS = {
  "": "Alla",
  "att-hantera": "Att hantera (ny eller behandlas)",
  NEW: "Ny",
  PROCESSING: "Behandlas",
  SHIPPED: "Skickad",
  COMPLETED: "Slutförd",
  CANCELLED: "Avbruten",
} as const;
export type OrderFulfillmentFilter = keyof typeof ORDER_FULFILLMENT_FILTERS;

export const ORDER_SORTS = {
  nyast: "Nyast först",
  aldst: "Äldst först",
  belopp: "Högst belopp",
} as const;
export type OrderSort = keyof typeof ORDER_SORTS;

export type AdminOrderListParams = {
  q: string;
  payment: OrderPaymentFilter;
  fulfillment: OrderFulfillmentFilter;
  /** Only orders with an open needs-attention item. */
  attention: boolean;
  /** Order date range (Stockholm calendar days, inclusive). */
  from: IsoDate | "";
  to: IsoDate | "";
  sort: OrderSort;
  page: number;
};

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const oneOf = <T extends string>(values: readonly T[], fallback: T) =>
  z.preprocess(first, z.enum(values as [T, ...T[]])).catch(fallback);
const isoDate = z.preprocess(first, z.iso.date()).catch("");

const schema = z.object({
  q: z.preprocess(first, z.string().trim().max(100)).catch(""),
  betalning: oneOf(
    Object.keys(ORDER_PAYMENT_FILTERS) as OrderPaymentFilter[],
    "",
  ),
  leverans: oneOf(
    Object.keys(ORDER_FULFILLMENT_FILTERS) as OrderFulfillmentFilter[],
    "",
  ),
  atgard: z.preprocess(first, z.literal("1").optional()).catch(undefined),
  fran: isoDate,
  till: isoDate,
  sortering: oneOf(Object.keys(ORDER_SORTS) as OrderSort[], "nyast"),
  sida: z.preprocess(first, z.coerce.number().int().min(1).max(1_000)).catch(1),
});

export function parseAdminOrderParams(
  searchParams: Record<string, string | string[] | undefined>,
): AdminOrderListParams {
  const parsed = schema.parse(searchParams);
  return {
    q: parsed.q,
    payment: parsed.betalning,
    fulfillment: parsed.leverans,
    attention: parsed.atgard === "1",
    from: parsed.fran,
    to: parsed.till,
    sort: parsed.sortering,
    page: parsed.sida,
  };
}

/**
 * Payment statuses a filter selects; null means "no condition". The default
 * hides abandoned checkouts (EXPIRED), which are noise for daily work, but
 * not when looking for problems: a payment that arrived for an abandoned
 * checkout is exactly such a problem.
 */
export function paymentStatusesFor(
  filter: OrderPaymentFilter,
  attentionOnly: boolean,
): readonly PaymentStatus[] | null {
  switch (filter) {
    case "alla":
      return null;
    case "":
      return attentionOnly
        ? null
        : ["PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"];
    case "betalda":
      return ["PAID", "PARTIALLY_REFUNDED"];
    default:
      return [filter];
  }
}

export function fulfillmentStatusesFor(
  filter: OrderFulfillmentFilter,
): readonly FulfillmentStatus[] | null {
  if (filter === "") return null;
  if (filter === "att-hantera") return ["NEW", "PROCESSING"];
  return [filter];
}

export type OrderSearch =
  | { kind: "none" }
  | { kind: "orderNumber"; orderNumber: number }
  | { kind: "stripeId"; id: string }
  | { kind: "text"; terms: string[] };

/**
 * Interprets the search box: "HC-10001" or "10001" → that order number;
 * a Stripe Checkout Session or PaymentIntent ID → that order; anything
 * else → name or email terms (all must match).
 */
export function parseOrderSearch(q: string): OrderSearch {
  const value = q.trim();
  if (!value) return { kind: "none" };
  const number = /^(?:hc-?)?(\d{1,9})$/i.exec(value);
  if (number) return { kind: "orderNumber", orderNumber: Number(number[1]) };
  if (/^(?:cs|pi)_[A-Za-z0-9_]{1,250}$/.test(value)) {
    return { kind: "stripeId", id: value };
  }
  return {
    kind: "text",
    terms: value.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5),
  };
}

/** Builds a list URL that keeps the other filters. */
export function adminOrdersHref(
  params: AdminOrderListParams,
  overrides: Partial<AdminOrderListParams> = {},
): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.payment) query.set("betalning", merged.payment);
  if (merged.fulfillment) query.set("leverans", merged.fulfillment);
  if (merged.attention) query.set("atgard", "1");
  if (merged.from) query.set("fran", merged.from);
  if (merged.to) query.set("till", merged.to);
  if (merged.sort !== "nyast") query.set("sortering", merged.sort);
  if (merged.page > 1) query.set("sida", String(merged.page));
  const search = query.toString();
  return search ? `/admin/orders?${search}` : "/admin/orders";
}
