import { formatInstantDate } from "@/lib/dates";
import { formatSek } from "@/lib/money";
import { formatOrderNumber } from "@/server/domain/order-number";

import {
  button,
  EMAIL_COLORS,
  emailDocument,
  escapeHtml,
  heading,
  itemTable,
  keyValueTable,
  lines,
  link,
  paragraph,
  raw,
  subheading,
  type Html,
} from "@/lib/email/html";
import type { EmailMessage } from "@/lib/email/transport";

/*
 * Customer order emails (PROJECT.md §40, §41, §39). Pure functions of the
 * order's own stored values: names, prices and totals come from the
 * OrderItem/Order snapshots taken at checkout, never from current Product
 * data, so an email always shows what the customer actually bought and
 * paid. No internal IDs or Stripe identifiers are included.
 */

export type OrderEmailLine = {
  name: string;
  quantity: number;
  unitPriceAmount: number;
  totalPriceAmount: number;
};

export type OrderEmailData = {
  orderNumber: number;
  customerName: string;
  /** The finalized order's email: the only possible recipient. */
  email: string;
  paidAt: Date;
  items: readonly OrderEmailLine[];
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  address: {
    line1: string;
    line2: string | null;
    postalCode: string;
    city: string;
  };
  shippingCarrier: "POSTNORD" | "OTHER" | null;
  trackingNumber: string | null;
};

export type EmailStoreInfo = {
  storeName: string;
  contactEmail: string;
  companyName: string | null;
  organizationNumber: string | null;
  /** Public origin, e.g. https://heavycards.se. */
  siteUrl: string;
};

/**
 * The optional "review your purchase" section of the shipping email. Its URL
 * is a secure, single-order review link created by Milestone 11; until then
 * no section is rendered.
 */
export type ShippedEmailOptions = { review?: { url: string } };

/** Only PostNord has a customer-facing name; "OTHER" says nothing useful. */
const carrierName = (carrier: OrderEmailData["shippingCarrier"]) =>
  carrier === "POSTNORD" ? "PostNord" : null;

const quantityLabel = (quantity: number) => `${quantity} st`;

function addressLines(order: OrderEmailData): string[] {
  return [
    order.customerName,
    order.address.line1,
    ...(order.address.line2 ? [order.address.line2] : []),
    `${order.address.postalCode} ${order.address.city}`,
    "Sverige",
  ];
}

function totalsRows(order: OrderEmailData) {
  return [
    { label: "Delsumma", value: formatSek(order.subtotalAmount) },
    {
      label: "Frakt",
      value:
        order.shippingAmount === 0
          ? "Fri frakt"
          : formatSek(order.shippingAmount),
    },
    { label: "Totalt", value: formatSek(order.totalAmount), strong: true },
  ];
}

const contactUrl = (store: EmailStoreInfo) => `${store.siteUrl}/kontakt`;

function supportHtml(store: EmailStoreInfo, orderNumber: string): Html[] {
  return [
    subheading("Frågor?"),
    paragraph(
      raw(
        `Svara på det här mejlet eller kontakta oss på ${link(store.contactEmail, `mailto:${store.contactEmail}`).html}. Ange gärna ordernummer ${escapeHtml(orderNumber)}.`,
      ),
    ),
  ];
}

const supportText = (store: EmailStoreInfo, orderNumber: string) =>
  `Frågor?\nSvara på det här mejlet eller kontakta oss på ${store.contactEmail}. Ange gärna ordernummer ${orderNumber}.`;

function footerParts(store: EmailStoreInfo): string[] {
  return [
    store.companyName ?? store.storeName,
    ...(store.organizationNumber ? [`Org.nr ${store.organizationNumber}`] : []),
  ];
}

function footerHtml(store: EmailStoreInfo): Html[] {
  return [
    raw(
      `<p style="margin:0 0 4px">${footerParts(store).map(escapeHtml).join(" · ")}</p>`,
    ),
    raw(
      `<p style="margin:0"><a href="${escapeHtml(store.siteUrl)}" style="color:${EMAIL_COLORS.muted}">${escapeHtml(store.siteUrl.replace(/^https?:\/\//, ""))}</a> · <a href="${escapeHtml(contactUrl(store))}" style="color:${EMAIL_COLORS.muted}">Kundservice</a></p>`,
    ),
  ];
}

const footerText = (store: EmailStoreInfo) =>
  `${footerParts(store).join(" · ")}\n${store.siteUrl}`;

const textDocument = (blocks: ReadonlyArray<string | null>) =>
  `HEAVYCARDS\n\n${blocks.filter((block) => block !== null).join("\n\n")}\n`;

/** Sent once, after HeavyCards has verified the payment (PROJECT.md §41). */
export function orderConfirmationEmail(
  order: OrderEmailData,
  store: EmailStoreInfo,
): EmailMessage {
  const number = formatOrderNumber(order.orderNumber);
  const date = formatInstantDate(order.paidAt);
  const carrier = carrierName(order.shippingCarrier);
  const intro =
    "Vi har tagit emot din betalning och din beställning är bekräftad. Vi meddelar dig per mejl när paketet har skickats.";
  const vat = `Varav moms ${formatSek(order.taxAmount)}`;

  const html = emailDocument({
    title: `Orderbekräftelse ${number}`,
    preheader: `Tack för din beställning! Ordernummer ${number}.`,
    content: [
      heading("Tack för din beställning!"),
      paragraph(`Hej ${order.customerName},`),
      paragraph(intro),
      keyValueTable([
        { label: "Ordernummer", value: number },
        { label: "Orderdatum", value: date },
      ]),
      subheading("Din beställning"),
      itemTable(
        order.items.map((item) => ({
          name: item.name,
          detail: `${quantityLabel(item.quantity)} × ${formatSek(item.unitPriceAmount)}`,
          amount: formatSek(item.totalPriceAmount),
        })),
      ),
      keyValueTable(totalsRows(order)),
      paragraph(vat, { muted: true }),
      subheading("Leveransadress"),
      lines(addressLines(order)),
      ...(carrier ? [paragraph(`Leveranssätt: ${carrier}`)] : []),
      ...supportHtml(store, number),
    ],
    footer: footerHtml(store),
  });

  const text = textDocument([
    "Tack för din beställning!",
    `Hej ${order.customerName},`,
    intro,
    `Ordernummer: ${number}\nOrderdatum: ${date}`,
    `DIN BESTÄLLNING\n${order.items
      .map(
        (item) =>
          `${item.name}\n  ${quantityLabel(item.quantity)} × ${formatSek(item.unitPriceAmount)} = ${formatSek(item.totalPriceAmount)}`,
      )
      .join("\n")}`,
    `${totalsRows(order)
      .map((row) => `${row.label}: ${row.value}`)
      .join("\n")}\n${vat}`,
    `LEVERANSADRESS\n${addressLines(order).join("\n")}${carrier ? `\nLeveranssätt: ${carrier}` : ""}`,
    supportText(store, number),
    footerText(store),
  ]);

  return {
    to: order.email,
    subject: `Orderbekräftelse ${number}`,
    text,
    html,
    replyTo: store.contactEmail,
    personalData: true,
  };
}

/** Sent once, when the order first becomes SHIPPED (PROJECT.md §39, §45). */
export function orderShippedEmail(
  order: OrderEmailData,
  store: EmailStoreInfo,
  options: ShippedEmailOptions = {},
): EmailMessage {
  const number = formatOrderNumber(order.orderNumber);
  const carrier = carrierName(order.shippingCarrier);
  const intro = `Vi har nu skickat din beställning ${number}.`;
  const tracking = order.trackingNumber;
  const shipmentRows = [
    ...(carrier ? [{ label: "Fraktbolag", value: carrier }] : []),
    ...(tracking ? [{ label: "Spårningsnummer", value: tracking }] : []),
  ];
  // A tracking number is shown as-is: no carrier URL is fabricated.
  const trackingHint = tracking
    ? carrier
      ? `Följ paketet med spårningsnumret hos ${carrier}.`
      : "Följ paketet med spårningsnumret hos fraktbolaget."
    : null;
  const reviewIntro =
    "När du har fått din beställning får du gärna berätta vad du tycker.";

  const html = emailDocument({
    title: `Din beställning ${number} har skickats`,
    preheader: `Din beställning ${number} är på väg.`,
    content: [
      heading("Din beställning är på väg!"),
      paragraph(`Hej ${order.customerName},`),
      paragraph(intro),
      ...(shipmentRows.length > 0
        ? [subheading("Leverans"), keyValueTable(shipmentRows)]
        : []),
      ...(trackingHint ? [paragraph(trackingHint, { muted: true })] : []),
      subheading("Innehåll"),
      itemTable(
        order.items.map((item) => ({
          name: item.name,
          detail: quantityLabel(item.quantity),
        })),
      ),
      subheading("Leveransadress"),
      lines(addressLines(order)),
      ...(options.review
        ? [
            subheading("Vad tyckte du?"),
            paragraph(reviewIntro),
            button("Recensera ditt köp", options.review.url),
          ]
        : []),
      ...supportHtml(store, number),
    ],
    footer: footerHtml(store),
  });

  const text = textDocument([
    "Din beställning är på väg!",
    `Hej ${order.customerName},`,
    intro,
    shipmentRows.length > 0
      ? `LEVERANS\n${shipmentRows.map((row) => `${row.label}: ${row.value}`).join("\n")}${trackingHint ? `\n${trackingHint}` : ""}`
      : null,
    `INNEHÅLL\n${order.items.map((item) => `${item.name} – ${quantityLabel(item.quantity)}`).join("\n")}`,
    `LEVERANSADRESS\n${addressLines(order).join("\n")}`,
    options.review
      ? `VAD TYCKTE DU?\n${reviewIntro}\nRecensera ditt köp: ${options.review.url}`
      : null,
    supportText(store, number),
    footerText(store),
  ]);

  return {
    to: order.email,
    subject: `Din beställning ${number} har skickats`,
    text,
    html,
    replyTo: store.contactEmail,
    personalData: true,
  };
}
