import Link from "next/link";

import { formatInstantDateTime } from "@/lib/dates";
import { formatSek } from "@/lib/money";
import { publicOrderNumber } from "@/server/admin/orders/presenters";
import type { AdminOrderRow } from "@/server/admin/orders/queries";

import { AttentionBadge, FulfillmentBadge, PaymentBadge } from "./order-badges";

/** Column template shared by the list header and its rows. */
export const ORDER_ROW_COLUMNS =
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)]";

const cellLabel = "text-xs text-muted-foreground lg:sr-only";

/** One order in the list: number, date, name only, statuses and amount. */
export function OrderRow({ row }: { row: AdminOrderRow }) {
  return (
    <li
      data-testid="admin-order-row"
      className={`grid grid-cols-2 gap-x-4 gap-y-3 bg-background px-5 py-4 lg:items-center ${ORDER_ROW_COLUMNS}`}
    >
      <div>
        <Link
          href={`/admin/orders/${row.id}`}
          className="font-semibold underline-offset-4 hover:underline"
        >
          {publicOrderNumber(row.orderNumber)}
        </Link>
        <p className="text-xs text-muted-foreground">
          {formatInstantDateTime(row.createdAt)}
        </p>
      </div>
      <div className="min-w-0 text-sm">
        <p className={cellLabel}>Kund</p>
        <p className="break-words">{row.customerName ?? "–"}</p>
        <p className="text-xs text-muted-foreground">
          {row.units} {row.units === 1 ? "artikel" : "artiklar"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className={`${cellLabel} w-full`}>Betalning</p>
        <PaymentBadge status={row.paymentStatus} />
        {row.openAttention > 0 && <AttentionBadge />}
      </div>
      <div>
        <p className={cellLabel}>Leverans</p>
        <FulfillmentBadge status={row.fulfillmentStatus} />
      </div>
      <div className="text-sm tabular-nums lg:text-right">
        <p className={cellLabel}>Belopp</p>
        <p className="font-semibold">{formatSek(row.totalAmount)}</p>
        {row.refundedAmount > 0 && (
          <p className="text-xs text-muted-foreground">
            −{formatSek(row.refundedAmount)} återbetalt
          </p>
        )}
      </div>
    </li>
  );
}
