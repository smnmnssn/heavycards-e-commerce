import type {
  EmailDeliveryStatus,
  EmailKind,
  FulfillmentStatus,
  PaymentStatus,
  ShippingCarrier,
} from "@/generated/prisma/enums";
import { formatSek } from "@/lib/money";

/*
 * Swedish labels and safe descriptions for the admin order screens. Pure,
 * so pages, the dashboard and tests share one wording.
 *
 * Audit metadata is never rendered as raw JSON: each known action is turned
 * into a sentence from a few whitelisted fields (statuses, amounts, problem
 * codes, tracking details). Unknown fields are ignored, so a future metadata
 * key can never leak onto the screen by accident.
 */

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Väntar på betalning",
  PAID: "Betald",
  PARTIALLY_REFUNDED: "Delvis återbetald",
  REFUNDED: "Återbetald",
  FAILED: "Betalning misslyckades",
  EXPIRED: "Avbruten kassa",
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  NEW: "Ny",
  PROCESSING: "Behandlas",
  SHIPPED: "Skickad",
  COMPLETED: "Slutförd",
  CANCELLED: "Avbruten",
};

/** Button texts for moving an order to a fulfillment status. */
export const FULFILLMENT_ACTION_LABELS: Record<
  Exclude<FulfillmentStatus, "NEW">,
  string
> = {
  PROCESSING: "Markera som behandlas",
  SHIPPED: "Markera som skickad",
  COMPLETED: "Markera som slutförd",
  CANCELLED: "Avbryt beställningen",
};

export const CARRIER_LABELS: Record<ShippingCarrier, string> = {
  POSTNORD: "PostNord",
  OTHER: "Annat fraktbolag",
};

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  ORDER_CONFIRMATION: "Orderbekräftelse",
  ORDER_SHIPPED: "Leveransbesked",
};

export const EMAIL_STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  PENDING: "Väntar på att skickas",
  SENT: "Skickat",
  FAILED: "Misslyckades",
  CANCELLED: "Skickas inte",
};

/** "HC-10001": the customer-facing number (never the database ID). */
export const publicOrderNumber = (orderNumber: number) => `HC-${orderNumber}`;

// --- Needs attention ----------------------------------------------------------------

/** Audit actions that record a problem staff must look at. */
export const ATTENTION_ACTIONS = {
  payment: "PAYMENT_NEEDS_ATTENTION",
  email: "EMAIL_NEEDS_ATTENTION",
  /** Only with `stockShortfalls` in its metadata. */
  paidWithShortfall: "MARK_ORDER_PAID",
} as const;

export type AttentionKind = "payment" | "email" | "stock";

export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  payment: "betalning",
  email: "e-post",
  stock: "lager",
};

export type AttentionDescription = {
  kind: AttentionKind;
  title: string;
  /** What staff should do; never asks them to touch the database. */
  guidance: string;
};

const PAYMENT_PROBLEMS: Record<string, string> = {
  amount_mismatch: "Beloppet hos Stripe stämmer inte med beställningens total.",
  currency_mismatch: "Betalningen hos Stripe är inte i SEK.",
  missing_customer_data:
    "Kunduppgifter från Stripe saknas eller är ogiltiga (namn, e-post eller svensk leveransadress).",
  missing_payment:
    "Stripe rapporterade sessionen som betald men utan betalning.",
  reservations_not_active:
    "Lagerreservationen gällde inte längre när betalningen kom.",
  paid_after_close:
    "Stripe rapporterar betalning för en kassa som HeavyCards redan hade stängt.",
  unexpected_session_state: "Stripe rapporterade ett oväntat kassatillstånd.",
};

const PAYMENT_GUIDANCE =
  "Beställningen markerades inte som betald och inget lager drogs. Kontrollera betalningen i Stripe Dashboard och återbetala den där om varorna inte kan levereras. Kontakta kunden vid behov.";

const EMAIL_PROBLEMS: Record<string, string> = {
  max_attempts: "Alla automatiska försök misslyckades.",
  outcome_unknown:
    "Det är okänt om ett tidigare försök nådde kunden, och ett nytt försök kunde ge dubbla mejl.",
  invalid_idempotent_request:
    "E-posttjänsten har redan tagit emot ett annat mejl med samma nyckel.",
  missing_customer_data: "Beställningen saknar mottagaruppgifter.",
};

const EMAIL_GUIDANCE =
  "Inget nytt försök görs automatiskt. Kontrollera i Resend om mejlet kom fram, och kontakta annars kunden direkt.";

type Meta = Record<string, unknown>;

const asMeta = (metadata: unknown): Meta =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Meta)
    : {};
const str = (meta: Meta, key: string) =>
  typeof meta[key] === "string" ? (meta[key] as string) : null;
const int = (meta: Meta, key: string) =>
  Number.isInteger(meta[key]) ? (meta[key] as number) : null;

function emailKindLabel(value: string | null): string {
  return value && value in EMAIL_KIND_LABELS
    ? EMAIL_KIND_LABELS[value as EmailKind]
    : "E-post";
}

/** Units missing at payment, from MARK_ORDER_PAID's `stockShortfalls`. */
function shortfallUnits(meta: Meta): number {
  const list = meta.stockShortfalls;
  if (!Array.isArray(list)) return 0;
  return list.reduce<number>((sum, entry) => {
    const missing = asMeta(entry).missing;
    return sum + (Number.isInteger(missing) ? (missing as number) : 0);
  }, 0);
}

/** Whether an audit entry is an attention item (see ATTENTION_ACTIONS). */
export function isAttentionEntry(action: string, metadata: unknown): boolean {
  if (action === ATTENTION_ACTIONS.payment) return true;
  if (action === ATTENTION_ACTIONS.email) return true;
  return (
    action === ATTENTION_ACTIONS.paidWithShortfall &&
    Array.isArray(asMeta(metadata).stockShortfalls)
  );
}

export function describeAttention(
  action: string,
  metadata: unknown,
): AttentionDescription {
  const meta = asMeta(metadata);
  const problem = str(meta, "problem");
  if (action === ATTENTION_ACTIONS.email) {
    return {
      kind: "email",
      title: `${emailKindLabel(str(meta, "kind"))} kunde inte skickas. ${
        (problem && EMAIL_PROBLEMS[problem]) ?? "Leveransen stoppades."
      }`,
      guidance: EMAIL_GUIDANCE,
    };
  }
  if (action === ATTENTION_ACTIONS.paidWithShortfall) {
    const units = shortfallUnits(meta);
    return {
      kind: "stock",
      title: `Betald, men lagret räckte inte: ${units} st saknades när betalningen kom.`,
      guidance:
        "Lagersaldot hade sänkts under det reserverade antalet. Kontrollera lagret innan beställningen packas, och återbetala i Stripe om varorna inte finns.",
    };
  }
  return {
    kind: "payment",
    title:
      (problem && PAYMENT_PROBLEMS[problem]) ??
      "Betalningen kunde inte stämmas av mot Stripe.",
    guidance: PAYMENT_GUIDANCE,
  };
}

// --- Order timeline -----------------------------------------------------------------

const paymentLabel = (value: string | null) =>
  value && value in PAYMENT_STATUS_LABELS
    ? PAYMENT_STATUS_LABELS[value as PaymentStatus]
    : "okänd";
const fulfillmentLabel = (value: string | null) =>
  value && value in FULFILLMENT_STATUS_LABELS
    ? FULFILLMENT_STATUS_LABELS[value as FulfillmentStatus]
    : "okänd";
const carrierLabel = (value: string | null) =>
  value && value in CARRIER_LABELS
    ? CARRIER_LABELS[value as ShippingCarrier]
    : null;

function trackingText(tracking: Meta): string {
  const number = str(tracking, "trackingNumber");
  const carrier = carrierLabel(str(tracking, "shippingCarrier"));
  const parts = [carrier, number ? `spårningsnummer ${number}` : null].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : "inget spårningsnummer";
}

const RECHECK_OUTCOME_LABELS: Record<string, string> = {
  paid: "betald, beställningen slutfördes",
  expired: "kassan hade gått ut, lagret släpptes",
  failed: "betalningen misslyckades, lagret släpptes",
  processing: "betalningen behandlas fortfarande, lagret är kvar reserverat",
  open: "kassan är fortfarande öppen, lagret är kvar reserverat",
  needs_attention: "fortfarande avvikelse, lagret är kvar reserverat",
  unavailable: "Stripe kunde inte nås, lagret är kvar reserverat",
};

/** One audit entry of an order as a Swedish sentence (no raw metadata). */
export function describeOrderEvent(action: string, metadata: unknown): string {
  const meta = asMeta(metadata);
  switch (action) {
    case "MARK_ORDER_PAID": {
      const source =
        str(meta, "source") === "reconciliation" ? " (vid avstämning)" : "";
      const units = shortfallUnits(meta);
      return `Betalningen bekräftades av Stripe${source}.${
        units > 0 ? ` Lagret räckte inte: ${units} st saknades.` : ""
      }`;
    }
    case "MARK_ORDER_PAYMENT_FAILED":
      return "Betalningen misslyckades hos Stripe; lagret frigjordes.";
    case "SYNC_ORDER_REFUND": {
      const amount = int(meta, "refundedAmount");
      return `Återbetalning synkad från Stripe: ${paymentLabel(
        str(meta, "from"),
      )} → ${paymentLabel(str(meta, "to"))}${
        amount !== null ? `, totalt återbetalt ${formatSek(amount)}` : ""
      }.`;
    }
    case "PAYMENT_NEEDS_ATTENTION":
    case "EMAIL_NEEDS_ATTENTION":
      return `Kräver uppmärksamhet: ${describeAttention(action, meta).title}`;
    case "UPDATE_ORDER_STATUS": {
      const to = str(meta, "to");
      return `Leveransstatus ändrad: ${fulfillmentLabel(
        str(meta, "from"),
      )} → ${fulfillmentLabel(to)}${
        to === "SHIPPED" ? ` (${trackingText(meta)})` : ""
      }.`;
    }
    case "UPDATE_ORDER_TRACKING":
      return `Spårningsuppgifter ändrade: ${trackingText(
        asMeta(meta.from),
      )} → ${trackingText(asMeta(meta.to))}.`;
    case "RECHECK_ORDER_PAYMENT": {
      const outcome = str(meta, "outcome");
      return `Betalningen kontrollerades med Stripe igen: ${
        (outcome && RECHECK_OUTCOME_LABELS[outcome]) ?? "ingen ändring"
      }.`;
    }
    case "RESOLVE_ORDER_ATTENTION": {
      const kind = str(meta, "kind");
      const what =
        kind && kind in ATTENTION_KIND_LABELS
          ? ATTENTION_KIND_LABELS[kind as AttentionKind]
          : "problem";
      return `Markerat som hanterat (${what}).`;
    }
    case "OPERATOR_RELEASE_PAYMENT_HOLD":
      return str(meta, "evidence") === "payment_canceled"
        ? "Reservationen släpptes av en ägare: Stripe visar att betalningen avbröts. Beställningen avslutades utan betalning."
        : "Reservationen släpptes av en ägare: Stripe visar att betalningen är helt återbetald. Beställningen avslutades utan betalning.";
    case "OPERATOR_REQUEUE_EMAIL":
      return `E-postmeddelandet (${
        str(meta, "kind") === "ORDER_SHIPPED"
          ? "leveransbesked"
          : "orderbekräftelse"
      }) lades i kö igen av en ägare.`;
    default:
      return `Händelse: ${action}`;
  }
}
