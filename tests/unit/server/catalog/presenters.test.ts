import { describe, expect, it } from "vitest";

import {
  imageAlt,
  releaseNote,
  toProductCardData,
} from "@/server/catalog/presenters";
import { productJsonLd, schemaPrice } from "@/server/catalog/product-json-ld";
import type {
  ProductDetail,
  ProductSummary,
} from "@/server/data/catalog-queries";

const now = new Date("2026-10-01T10:00:00Z");
const context = { now, today: "2026-10-01", lowStockThreshold: 3 };

const summary = (overrides: Partial<ProductSummary> = {}): ProductSummary => ({
  id: "p1",
  slug: "destined-rivals-booster-box",
  name: "Destined Rivals Booster Box",
  status: "ACTIVE",
  isPreorder: false,
  priceAmount: 219_900,
  compareAtPriceAmount: null,
  releaseDate: null,
  publishedAt: new Date("2026-06-01T00:00:00Z"),
  setName: "Destined Rivals",
  availableQuantity: 10,
  image: null,
  ...overrides,
});

describe("toProductCardData", () => {
  it("maps an in-stock product without badges", () => {
    expect(toProductCardData(summary(), context)).toMatchObject({
      href: "/pokemon-tcg/destined-rivals-booster-box",
      subtitle: "Destined Rivals",
      badges: [],
      unavailable: false,
      note: null,
      image: null,
    });
  });

  it.each([
    [{ availableQuantity: 0 }, "Slutsåld", true],
    [{ availableQuantity: 2 }, "Få kvar", false],
    [
      { status: "COMING_SOON" as const, availableQuantity: 0 },
      "Kommer snart",
      true,
    ],
    [
      {
        status: "COMING_SOON" as const,
        isPreorder: true,
        availableQuantity: 5,
      },
      "Förbeställ",
      false,
    ],
  ])("derives the badge for %j", (overrides, label, unavailable) => {
    const card = toProductCardData(summary(overrides), context);

    expect(card.badges?.[0]?.label).toBe(label);
    expect(card.unavailable).toBe(unavailable);
  });

  it("adds a Nyhet badge only for recently published in-stock products", () => {
    const recent = { publishedAt: new Date("2026-09-25T00:00:00Z") };

    expect(
      toProductCardData(summary(recent), context).badges?.map((b) => b.label),
    ).toEqual(["Nyhet"]);
    expect(
      toProductCardData(
        summary({ ...recent, status: "COMING_SOON", isPreorder: true }),
        context,
      ).badges?.map((b) => b.label),
    ).toEqual(["Förbeställ"]);
  });

  it("notes future release dates only", () => {
    expect(
      toProductCardData(summary({ releaseDate: "2026-11-14" }), context).note,
    ).toBe("Släpps 14 november 2026");
    expect(
      toProductCardData(summary({ releaseDate: "2026-05-30" }), context).note,
    ).toBeNull();
    expect(releaseNote(null, "2026-10-01")).toBeNull();
  });

  it("uses the product name as alt text when none is stored", () => {
    const card = toProductCardData(
      summary({
        image: { url: "/x.webp", altText: null, width: 800, height: 800 },
      }),
      context,
    );

    expect(card.image?.alt).toBe("Destined Rivals Booster Box");
    expect(imageAlt("  Framsida  ", "X")).toBe("Framsida");
    expect(imageAlt(null, "X", 2)).toBe("X, bild 3");
  });
});

describe("product JSON-LD", () => {
  const detail = (overrides: Partial<ProductDetail> = {}): ProductDetail => ({
    id: "p1",
    slug: "destined-rivals-elite-trainer-box",
    name: "Destined Rivals Elite Trainer Box",
    shortDescription: null,
    description: null,
    productType: "SEALED",
    status: "ACTIVE",
    isPreorder: false,
    priceAmount: 74_950,
    compareAtPriceAmount: null,
    releaseDate: null,
    publishedAt: now,
    updatedAt: now,
    seoTitle: null,
    seoDescription: null,
    category: { slug: "elite-trainer-boxes", name: "Elite Trainer Boxes" },
    pokemonSet: null,
    images: [],
    availableQuantity: 4,
    reviews: [],
    reviewSummary: { count: 0, averageRating: null },
    ...overrides,
  });

  it("formats prices exactly from minor units", () => {
    expect(schemaPrice(74_950)).toBe("749.50");
    expect(schemaPrice(219_900)).toBe("2199.00");
    expect(schemaPrice(5)).toBe("0.05");
  });

  it("emits an offer that matches the visible price and availability", () => {
    const data = productJsonLd({
      siteUrl: "https://heavycards.se",
      product: detail(),
      state: "in_stock",
      description: "x",
    });

    expect(data).toMatchObject({
      "@type": "Product",
      url: "https://heavycards.se/pokemon-tcg/destined-rivals-elite-trainer-box",
      offers: {
        price: "749.50",
        priceCurrency: "SEK",
        availability: "https://schema.org/InStock",
      },
    });
    expect(data).not.toHaveProperty("aggregateRating");
  });

  it("omits the offer while a product cannot be ordered yet", () => {
    const data = productJsonLd({
      siteUrl: "https://heavycards.se",
      product: detail({ status: "COMING_SOON" }),
      state: "coming_soon",
      description: "x",
    });

    expect(data).not.toHaveProperty("offers");
  });

  it("includes ratings only from the approved summary", () => {
    const data = productJsonLd({
      siteUrl: "https://heavycards.se",
      product: detail({
        reviewSummary: { count: 2, averageRating: 4.5 },
        reviews: [
          {
            id: "r1",
            displayName: "Anna",
            rating: 5,
            title: null,
            body: "Bra",
            verifiedPurchase: true,
            createdAt: now,
          },
        ],
      }),
      state: "preorder",
      description: "x",
    });

    expect(data).toMatchObject({
      aggregateRating: { ratingValue: 4.5, reviewCount: 2 },
      offers: { availability: "https://schema.org/PreOrder" },
    });
  });
});
