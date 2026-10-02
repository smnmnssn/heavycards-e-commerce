import { describe, expect, it } from "vitest";

import {
  normalizeReviewText,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_DISPLAY_NAME_MAX,
  REVIEW_TITLE_MAX,
  reviewFieldErrors,
  reviewSubmissionSchema,
} from "@/lib/validation/reviews";

const valid = {
  orderItemId: "0199a8c0-0000-7000-8000-000000000001",
  rating: "5",
  title: "",
  body: "Fin förpackning och snabb leverans.",
  displayName: "",
};

const parse = (overrides: Record<string, unknown>) =>
  reviewSubmissionSchema.safeParse({ ...valid, ...overrides });

const errorsOf = (overrides: Record<string, unknown>) => {
  const result = parse(overrides);
  return result.success ? {} : reviewFieldErrors(result.error);
};

describe("reviewSubmissionSchema", () => {
  it("accepts a form submission and converts it", () => {
    const result = parse({ title: "  Bra  ", displayName: " Kim " });

    expect(result.success && result.data).toEqual({
      orderItemId: valid.orderItemId,
      rating: 5,
      title: "Bra",
      body: valid.body,
      displayName: "Kim",
    });
  });

  it("turns blank optional fields into null (missing form fields too)", () => {
    const result = parse({ title: "   ", displayName: null });

    expect(result.success && result.data).toMatchObject({
      title: null,
      displayName: null,
    });
  });

  it.each(["0", "6", "-1", "4.5", "", null, "fem", "1e1"])(
    "rejects rating %j",
    (rating) => {
      expect(errorsOf({ rating }).rating).toBe(
        "Välj ett betyg mellan 1 och 5 stjärnor.",
      );
    },
  );

  it.each(["1", "2", "3", "4", "5", 3])("accepts rating %j", (rating) => {
    expect(parse({ rating }).success).toBe(true);
  });

  it("requires review text of a sensible length, counted after trimming", () => {
    expect(errorsOf({ body: "  kort   " }).body).toBe(
      `Skriv minst ${REVIEW_BODY_MIN} tecken.`,
    );
    expect(errorsOf({ body: "x".repeat(REVIEW_BODY_MAX + 1) }).body).toBe(
      `Recensionen får vara högst ${REVIEW_BODY_MAX} tecken.`,
    );
    expect(parse({ body: "x".repeat(REVIEW_BODY_MAX) }).success).toBe(true);
    expect(errorsOf({ body: undefined }).body).toBeDefined();
  });

  it("counts characters, not UTF-16 units (emoji, å ä ö)", () => {
    expect(parse({ body: "😀".repeat(REVIEW_BODY_MAX) }).success).toBe(true);
    expect(parse({ body: "åäö".repeat(4) }).success).toBe(true);
  });

  it("refuses oversized input before normalizing it", () => {
    expect(errorsOf({ body: " ".repeat(100_000) + "Bra produkt!" }).body).toBe(
      "Texten är för lång.",
    );
  });

  it("limits title and display name", () => {
    expect(errorsOf({ title: "x".repeat(REVIEW_TITLE_MAX + 1) }).title).toBe(
      `Rubriken får vara högst ${REVIEW_TITLE_MAX} tecken.`,
    );
    expect(
      errorsOf({ displayName: "x".repeat(REVIEW_DISPLAY_NAME_MAX + 1) })
        .displayName,
    ).toBe(`Namnet får vara högst ${REVIEW_DISPLAY_NAME_MAX} tecken.`);
  });

  it.each(["kim@example.com", "https://spam.example", "www.spam.se"])(
    "refuses an email or web address as display name: %s",
    (displayName) => {
      expect(errorsOf({ displayName }).displayName).toBe(
        "Ange ett namn, inte en e-post- eller webbadress.",
      );
    },
  );

  it("refuses control characters", () => {
    expect(errorsOf({ body: "Bra produkt\u0000!!!" }).body).toBe(
      "Texten innehåller otillåtna tecken.",
    );
  });

  it("keeps HTML as plain text (rendering escapes it)", () => {
    const body = '<script>alert("x")</script> <b>fet</b>';
    const result = parse({ body });
    expect(result.success && result.data.body).toBe(body);
  });

  it("accepts only an order line ID, never a product ID or status", () => {
    expect(errorsOf({ orderItemId: "HC-10001" }).orderItemId).toBeDefined();
    const result = parse({
      productId: "0199a8c0-0000-7000-8000-000000000002",
      verifiedPurchase: false,
      status: "APPROVED",
    });
    expect(result.success && Object.keys(result.data).sort()).toEqual([
      "body",
      "displayName",
      "orderItemId",
      "rating",
      "title",
    ]);
  });
});

describe("normalizeReviewText", () => {
  it("normalizes line endings, spaces, empty lines and invisible characters", () => {
    expect(
      normalizeReviewText("  Rad 1\r\n\r\n\r\n\r\nRad\t\t 2​  \rRad 3  ", {
        multiline: true,
      }),
    ).toBe("Rad 1\n\nRad 2\nRad 3");
  });

  it("makes single-line fields one line", () => {
    expect(normalizeReviewText(" Kim \n\t Kund ", { multiline: false })).toBe(
      "Kim Kund",
    );
  });

  it("composes Unicode (NFC), so å is one character", () => {
    expect(normalizeReviewText("å", { multiline: false })).toBe("å");
  });
});
