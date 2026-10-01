import { describe, expect, it } from "vitest";

import {
  orderConfirmationEmail,
  orderShippedEmail,
  type EmailStoreInfo,
  type OrderEmailData,
} from "@/server/email/order-templates";

/** Intl uses non-breaking spaces in "1 499,00 kr"; compare on plain spaces. */
const plain = (value: string) => value.replaceAll(/[  ]/g, " ");

const store: EmailStoreInfo = {
  storeName: "HeavyCards",
  contactEmail: "kundservice@heavycards.se",
  companyName: "HeavyCards AB",
  organizationNumber: "559000-0000",
  siteUrl: "https://heavycards.se",
};

const order: OrderEmailData = {
  orderNumber: 10_042,
  customerName: "Kim Kund",
  email: "kim@example.com",
  paidAt: new Date("2026-10-01T22:30:00Z"), // 2 oktober in Stockholm
  items: [
    {
      name: "Destined Rivals Booster Box",
      quantity: 2,
      unitPriceAmount: 149_900,
      totalPriceAmount: 299_800,
    },
    {
      name: "Sleeves & <Deck> Box",
      quantity: 1,
      unitPriceAmount: 4_950,
      totalPriceAmount: 4_950,
    },
  ],
  subtotalAmount: 304_750,
  shippingAmount: 7_900,
  taxAmount: 62_530,
  totalAmount: 312_650,
  address: {
    line1: "Testgatan 1",
    line2: "Lgh 1102",
    postalCode: "111 22",
    city: "Stockholm",
  },
  shippingCarrier: "POSTNORD",
  trackingNumber: null,
};

describe("order confirmation email", () => {
  const email = orderConfirmationEmail(order, store);
  const text = plain(email.text);
  const html = plain(email.html);

  it("goes to the order's own address with a Swedish subject", () => {
    expect(email.to).toBe("kim@example.com");
    expect(email.subject).toBe("Orderbekräftelse HC-10042");
    expect(email.replyTo).toBe("kundservice@heavycards.se");
    expect(email.personalData).toBe(true);
  });

  it("shows brand, greeting, number and the Stockholm order date", () => {
    for (const body of [text, html]) {
      expect(body).toContain("HEAVYCARDS");
      expect(body).toContain("Tack för din beställning!");
      expect(body).toContain("Hej Kim Kund,");
      expect(body).toContain("HC-10042");
      expect(body).toContain("2 oktober 2026");
    }
  });

  it("lists every line with quantity, historic unit price and line total", () => {
    expect(text).toContain(
      "Destined Rivals Booster Box\n  2 st × 1 499,00 kr = 2 998,00 kr",
    );
    expect(text).toContain("1 st × 49,50 kr = 49,50 kr");
    expect(html).toContain("2 st × 1 499,00 kr");
    expect(html).toContain("2 998,00 kr");
  });

  it("shows subtotal, shipping, total and the VAT included", () => {
    expect(text).toContain("Delsumma: 3 047,50 kr");
    expect(text).toContain("Frakt: 79,00 kr");
    expect(text).toContain("Totalt: 3 126,50 kr");
    expect(text).toContain("Varav moms 625,30 kr");
    for (const value of ["3 047,50 kr", "79,00 kr", "3 126,50 kr"]) {
      expect(html).toContain(value);
    }
  });

  it("says Fri frakt when shipping was free", () => {
    const free = orderConfirmationEmail(
      { ...order, shippingAmount: 0, totalAmount: order.subtotalAmount },
      store,
    );
    expect(plain(free.text)).toContain("Frakt: Fri frakt");
  });

  it("shows the delivery address, including an optional second line", () => {
    expect(text).toContain(
      "LEVERANSADRESS\nKim Kund\nTestgatan 1\nLgh 1102\n111 22 Stockholm\nSverige",
    );
    const single = orderConfirmationEmail(
      { ...order, address: { ...order.address, line2: null } },
      store,
    );
    expect(single.text).toContain("Testgatan 1\n111 22 Stockholm");
    expect(text).toContain("Leveranssätt: PostNord");
  });

  it("gives customer-service contact and company details", () => {
    expect(text).toContain("kundservice@heavycards.se");
    expect(html).toContain('href="mailto:kundservice@heavycards.se"');
    expect(html).toContain('href="https://heavycards.se/kontakt"');
    expect(text).toContain("HeavyCards AB · Org.nr 559000-0000");
  });

  it("does not claim the order has shipped", () => {
    expect(text).not.toMatch(/har nu skickat|är på väg|Spårningsnummer/);
    expect(email.subject).not.toMatch(/skickats/);
    expect(text).toContain("Vi meddelar dig per mejl när paketet har skickats");
  });

  it("escapes every value in the HTML", () => {
    expect(email.html).toContain("Sleeves &amp; &lt;Deck&gt; Box");
    expect(email.html).not.toContain("<Deck>");
    const hostile = orderConfirmationEmail(
      { ...order, customerName: '<img src=x onerror="alert(1)">' },
      store,
    );
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("is email-client friendly: inline styles, tables, no images or scripts", () => {
    expect(email.html).toMatch(/^<!doctype html><html lang="sv">/);
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("max-width:600px");
    expect(email.html).not.toMatch(/<img|<script|<link|<style|class=/i);
  });

  it("omits company details that are not configured", () => {
    const minimal = orderConfirmationEmail(order, {
      ...store,
      companyName: null,
      organizationNumber: null,
    });
    expect(minimal.text).not.toContain("Org.nr");
    expect(minimal.text).toContain("HeavyCards\nhttps://heavycards.se");
  });
});

describe("order shipped email", () => {
  it("says clearly in Swedish that the order has been shipped", () => {
    const email = orderShippedEmail(order, store);
    expect(email.to).toBe("kim@example.com");
    expect(email.subject).toBe("Din beställning HC-10042 har skickats");
    expect(email.text).toContain("Din beställning är på väg!");
    expect(email.text).toContain("Hej Kim Kund,");
    expect(email.text).toContain("Vi har nu skickat din beställning HC-10042.");
    expect(email.text).toContain(
      "INNEHÅLL\nDestined Rivals Booster Box – 2 st\nSleeves & <Deck> Box – 1 st",
    );
    expect(email.text).toContain("LEVERANSADRESS\nKim Kund\nTestgatan 1");
    expect(email.text).toContain("kundservice@heavycards.se");
    expect(email.html).toContain("HEAVYCARDS");
  });

  it("shows the tracking number and carrier when present, without a made-up URL", () => {
    const email = orderShippedEmail(
      { ...order, trackingNumber: "RR123456789SE" },
      store,
    );
    expect(email.text).toContain("Fraktbolag: PostNord");
    expect(email.text).toContain("Spårningsnummer: RR123456789SE");
    expect(email.html).toContain("RR123456789SE");
    expect(email.html).not.toMatch(/postnord\.se|tracking\.|href="[^"]*RR123/i);
  });

  it("has no tracking section without a tracking number", () => {
    const email = orderShippedEmail({ ...order, trackingNumber: null }, store);
    expect(email.text).not.toContain("Spårningsnummer");
    expect(email.html).not.toContain("Spårningsnummer");
    expect(email.text).toContain("Fraktbolag: PostNord");

    const unknownCarrier = orderShippedEmail(
      { ...order, trackingNumber: null, shippingCarrier: "OTHER" },
      store,
    );
    expect(unknownCarrier.text).not.toContain("LEVERANS\n");
    expect(unknownCarrier.html).not.toContain("Fraktbolag");
  });

  it("names no carrier for OTHER but still shows the tracking number", () => {
    const email = orderShippedEmail(
      { ...order, shippingCarrier: "OTHER", trackingNumber: "ABC-1" },
      store,
    );
    expect(email.text).not.toContain("Fraktbolag");
    expect(email.text).toContain("Spårningsnummer: ABC-1");
    expect(email.text).toContain("hos fraktbolaget");
  });

  it("leaves out prices", () => {
    expect(plain(orderShippedEmail(order, store).text)).not.toContain("kr");
  });

  it("renders no review section until a secure review link is supplied", () => {
    const without = orderShippedEmail(order, store);
    expect(without.text).not.toMatch(/recens/i);
    expect(without.html).not.toMatch(/recens/i);

    const url = "https://heavycards.se/review/SECURE-TOKEN";
    const withReview = orderShippedEmail(order, store, { review: { url } });
    expect(withReview.text).toContain(
      "När du har fått din beställning får du gärna berätta vad du tycker.",
    );
    expect(withReview.text).toContain(`Recensera ditt köp: ${url}`);
    expect(withReview.html).toContain(`href="${url}"`);
  });
});

describe("no internal identifiers", () => {
  it("never includes database or Stripe IDs", () => {
    for (const email of [
      orderConfirmationEmail(order, store),
      orderShippedEmail(order, store),
    ]) {
      expect(email.html).not.toMatch(
        /cs_(test|live)_|pi_|[0-9a-f]{8}-[0-9a-f]{4}-/,
      );
      expect(email.text).not.toMatch(
        /cs_(test|live)_|pi_|[0-9a-f]{8}-[0-9a-f]{4}-/,
      );
    }
  });
});
