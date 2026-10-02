import type {
  EmailDeliveryStatus,
  FulfillmentStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  EMAIL_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/server/admin/orders/presenters";
import { cn } from "@/lib/utils";

/*
 * Status labels for orders. Monochrome like the rest of admin: solid marks
 * what needs work next, outline an intermediate state, muted a closed one.
 * Only real problems (needs attention, failed email) use the error color.
 */

const PAYMENT_VARIANTS: Record<PaymentStatus, BadgeVariant> = {
  PAID: "solid",
  PARTIALLY_REFUNDED: "outline",
  REFUNDED: "muted",
  PENDING: "outline",
  FAILED: "muted",
  EXPIRED: "muted",
};

const FULFILLMENT_VARIANTS: Record<FulfillmentStatus, BadgeVariant> = {
  NEW: "solid",
  PROCESSING: "outline",
  SHIPPED: "muted",
  COMPLETED: "muted",
  CANCELLED: "muted",
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant={PAYMENT_VARIANTS[status]}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  return (
    <Badge variant={FULFILLMENT_VARIANTS[status]}>
      {FULFILLMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EmailStatusBadge({
  status,
  attempts,
}: {
  status: EmailDeliveryStatus;
  attempts: number;
}) {
  if (status === "FAILED") return <AttentionBadge>Misslyckades</AttentionBadge>;
  const label =
    status === "PENDING" && attempts > 0
      ? "Försöker igen"
      : EMAIL_STATUS_LABELS[status];
  return (
    <Badge variant={status === "SENT" ? "solid" : "outline"}>{label}</Badge>
  );
}

/** The one colored label: something is wrong and needs a person. */
export function AttentionBadge({
  children = "Kräver åtgärd",
  className,
}: {
  children?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border-destructive text-destructive", className)}
    >
      {children}
    </Badge>
  );
}
