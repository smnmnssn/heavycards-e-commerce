import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "@/lib/seo/json-ld";
import {
  imageAlt,
  LANDING_LEAD_MAX,
  landingCopy,
  releaseNote,
  toParagraphs,
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
    sku: "DRI-ETB",
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

describe("product JSON-LD (Milestone 13)", () => {
  const detail = (overrides: Partial<ProductDetail> = {}): ProductDetail => ({
    id: "p1",
    slug: "destined-rivals-elite-trainer-box",
    name: "Destined Rivals Elite Trainer Box",
    sku: "DRI-ETB",
    shortDescription: null,
    description: null,
    productType: "SEALED",
    status: "ACTIVE",
    isPreorder: false,
    priceAmount: 74_950,
    compareAtPriceAmount: 89_900,
    releaseDate: "2025-06-06",
    publishedAt: now,
    updatedAt: now,
    seoTitle: null,
    seoDescription: null,
    category: { slug: "elite-trainer-boxes", name: "Elite Trainer Boxes" },
    pokemonSet: { slug: "destined-rivals", name: "Destined Rivals" },
    images: [
      {
        id: "i1",
        url: "https://store.public.blob.vercel-storage.com/products/p1/a.webp",
        altText: null,
        width: 1600,
        height: 1600,
      },
      {
        id: "i2",
        url: "/api/media/products/p1/b.webp",
        altText: null,
        width: 1600,
        height: 1600,
      },
    ],
    availableQuantity: 4,
    reviews: [],
    reviewSummary: { count: 0, averageRating: null },
    ...overrides,
  });
  const jsonLd = (
    product: ProductDetail,
    state: Parameters<typeof productJsonLd>[0]["state"] = "in_stock",
  ) =>
    productJsonLd({
      siteUrl: "https://heavycards.se",
      product,
      state,
      description: "Beskrivning",
    });
  const review = (id: string, rating: number) => ({
    id,
    displayName: `Kund ${id}`,
    rating,
    title: null,
    body: "Bra",
    verifiedPurchase: true,
    createdAt: new Date("2026-09-01T12:00:00Z"),
  });

  it("identifies the product by its canonical URL and real SKU", () => {
    expect(jsonLd(detail())).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      "@id":
        "https://heavycards.se/pokemon-tcg/destined-rivals-elite-trainer-box#product",
      url: "https://heavycards.se/pokemon-tcg/destined-rivals-elite-trainer-box",
      name: "Destined Rivals Elite Trainer Box",
      sku: "DRI-ETB",
      category: "Elite Trainer Boxes",
      releaseDate: "2025-06-06",
      image: [
        "https://store.public.blob.vercel-storage.com/products/p1/a.webp",
        "https://heavycards.se/api/media/products/p1/b.webp",
      ],
    });
  });

  it("offers the visible current price, never the compare-at price", () => {
    const offer = (jsonLd(detail()) as { offers: Record<string, unknown> })
      .offers;
    expect(offer).toEqual({
      "@type": "Offer",
      url: "https://heavycards.se/pokemon-tcg/destined-rivals-elite-trainer-box",
      price: "749.50",
      priceCurrency: "SEK",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    });
  });

  it.each([
    ["low_stock", "https://schema.org/LimitedAvailability"],
    ["sold_out", "https://schema.org/OutOfStock"],
    ["preorder_sold_out", "https://schema.org/OutOfStock"],
  ] as const)("maps %s to %s", (state, availability) => {
    expect(jsonLd(detail(), state)).toMatchObject({
      offers: { availability },
    });
  });

  it("starts a preorder offer on the displayed release date", () => {
    const product = detail({
      status: "COMING_SOON",
      isPreorder: true,
      releaseDate: "2026-11-14",
    });
    expect(jsonLd(product, "preorder")).toMatchObject({
      offers: {
        availability: "https://schema.org/PreOrder",
        availabilityStarts: "2026-11-14",
      },
    });
    expect(
      (
        jsonLd(detail({ releaseDate: null }), "preorder") as {
          offers: object;
        }
      ).offers,
    ).not.toHaveProperty("availabilityStarts");
  });

  it("states new condition only for sealed products", () => {
    for (const productType of [
      "SINGLE",
      "GRADED",
      "ACCESSORY",
      "OTHER",
    ] as const) {
      const offer = (
        jsonLd(detail({ productType })) as { offers: Record<string, unknown> }
      ).offers;
      expect(offer).not.toHaveProperty("itemCondition");
    }
  });

  it("never claims brand, GTIN, shipping or return policy", () => {
    const json = JSON.stringify(jsonLd(detail()));
    for (const key of [
      "brand",
      "gtin",
      "mpn",
      "shippingDetails",
      "hasMerchantReturnPolicy",
      "manufacturer",
    ]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it("has no rating or review without approved reviews", () => {
    const data = jsonLd(detail());
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
  });

  it("rounds the approved average like the page and caps listed reviews", () => {
    const reviews = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
      review(id, 4),
    );
    const data = jsonLd(
      detail({
        reviews,
        reviewSummary: { count: 7, averageRating: 4.285714 },
      }),
    ) as { aggregateRating: object; review: Array<Record<string, unknown>> };

    expect(data.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.3,
      reviewCount: 7,
      bestRating: 5,
      worstRating: 1,
    });
    expect(data.review).toHaveLength(5);
    expect(data.review[0]).toEqual({
      "@type": "Review",
      author: { "@type": "Person", name: "Kund a" },
      datePublished: "2026-09-01",
      reviewBody: "Bra",
      reviewRating: {
        "@type": "Rating",
        ratingValue: 4,
        bestRating: 5,
        worstRating: 1,
      },
    });
  });

  it("keeps review text as plain data that cannot inject markup", () => {
    const hostile = {
      ...review("x", 5),
      body: "</script><img src=x onerror=alert(1)>",
    };
    const serialized = serializeJsonLd(
      jsonLd(
        detail({
          reviews: [hostile],
          reviewSummary: { count: 1, averageRating: 5 },
        }),
      ),
    );

    expect(serialized).not.toMatch(/[<>]/);
    expect(JSON.parse(serialized).review[0].reviewBody).toBe(hostile.body);
  });
});

describe("landing copy", () => {
  it("splits admin text into paragraphs on blank lines", () => {
    expect(toParagraphs("Ett\r\n\r\nTvå\nfortsätter\n\n\n Tre ")).toEqual([
      "Ett",
      "Två\nfortsätter",
      "Tre",
    ]);
    expect(toParagraphs(null)).toEqual([]);
  });

  it("uses the generated sentence without a description", () => {
    expect(landingCopy(null, "Standardtext.")).toEqual({
      lead: "Standardtext.",
      body: [],
    });
  });

  it("leads with the first paragraph and shows the rest below the products", () => {
    expect(landingCopy("Ingress.\n\nMer om setet.\n\nÄnnu mer.", "x")).toEqual({
      lead: "Ingress.",
      body: ["Mer om setet.", "Ännu mer."],
    });
  });

  it("shortens a long first paragraph and then shows the full text below", () => {
    const first = "Långt stycke om setet. ".repeat(30).trim();
    const copy = landingCopy(`${first}\n\nAndra.`, "x");

    expect(copy.lead.length).toBeLessThanOrEqual(LANDING_LEAD_MAX);
    expect(copy.lead.endsWith("…")).toBe(true);
    expect(copy.body).toEqual([first, "Andra."]);
  });
});
