import { describe, expect, it } from "vitest";

import {
  categoryFormSchema,
  fieldErrorsFrom,
  imageAltSchema,
  pokemonSetFormSchema,
  productFormSchema,
  type ProductFormValues,
} from "@/lib/validation/catalog";

const CATEGORY_ID = "01999999-0000-7000-8000-000000000001";
const SET_ID = "01999999-0000-7000-8000-000000000002";

const valid: ProductFormValues = {
  name: "  Destined Rivals Booster Box  ",
  slug: "Destined-Rivals-Booster-Box",
  shortDescription: "  36 boosters  ",
  description: "Rad ett\r\n\r\nRad två",
  productType: "SEALED",
  categoryId: CATEGORY_ID,
  pokemonSetId: SET_ID,
  price: "1 499",
  compareAtPrice: "1799,00",
  sku: " sv10-bb-en ",
  stockOnHand: "12",
  status: "ACTIVE",
  isPreorder: false,
  isFeatured: true,
  releaseDate: "2026-11-14",
  seoTitle: "",
  seoDescription: "   ",
};

const errorsFor = (values: Partial<ProductFormValues>) => {
  const result = productFormSchema.safeParse({ ...valid, ...values });
  return result.success ? {} : fieldErrorsFrom(result.error);
};

describe("productFormSchema", () => {
  it("normalizes valid input into domain values", () => {
    expect(productFormSchema.parse(valid)).toEqual({
      name: "Destined Rivals Booster Box",
      slug: "destined-rivals-booster-box",
      shortDescription: "36 boosters",
      description: "Rad ett\n\nRad två",
      productType: "SEALED",
      categoryId: CATEGORY_ID,
      pokemonSetId: SET_ID,
      price: 149_900,
      compareAtPrice: 179_900,
      sku: "SV10-BB-EN",
      stockOnHand: 12,
      status: "ACTIVE",
      isPreorder: false,
      isFeatured: true,
      releaseDate: "2026-11-14",
      seoTitle: null,
      seoDescription: null,
    });
  });

  it("treats blank optional fields as null", () => {
    const parsed = productFormSchema.parse({
      ...valid,
      pokemonSetId: "",
      compareAtPrice: "",
      releaseDate: "",
      shortDescription: "",
      description: "",
    });
    expect(parsed).toMatchObject({
      pokemonSetId: null,
      compareAtPrice: null,
      releaseDate: null,
      shortDescription: null,
      description: null,
    });
  });

  it.each([
    [{ name: "   " }, "name"],
    [{ slug: "ej giltig slug" }, "slug"],
    [{ slug: "a--b" }, "slug"],
    [{ price: "abc" }, "price"],
    [{ price: "0" }, "price"],
    [{ price: "-5" }, "price"],
    [{ price: "12,345" }, "price"],
    [{ compareAtPrice: "1499" }, "compareAtPrice"],
    [{ compareAtPrice: "1000" }, "compareAtPrice"],
    [{ sku: "" }, "sku"],
    [{ sku: "SV 10" }, "sku"],
    [{ stockOnHand: "-1" }, "stockOnHand"],
    [{ stockOnHand: "1.5" }, "stockOnHand"],
    [{ stockOnHand: "abc" }, "stockOnHand"],
    [{ stockOnHand: "1000001" }, "stockOnHand"],
    [{ categoryId: "" }, "categoryId"],
    [{ pokemonSetId: "not-a-uuid" }, "pokemonSetId"],
    [{ releaseDate: "2026-02-30" }, "releaseDate"],
    [{ releaseDate: "14/11/2026" }, "releaseDate"],
    [{ seoTitle: "x".repeat(201) }, "seoTitle"],
    [{ seoDescription: "x".repeat(501) }, "seoDescription"],
    [{ name: "x".repeat(201) }, "name"],
  ] as const)("rejects %j with a Swedish error on %s", (values, field) => {
    const errors = errorsFor(values as Partial<ProductFormValues>);
    expect(Object.keys(errors)).toContain(field);
    expect(errors[field]).toMatch(/[a-zåäö]/i);
  });

  it("rejects unknown enum values", () => {
    expect(
      Object.keys(
        errorsFor({ status: "SOLD_OUT" as never, productType: "X" as never }),
      ).sort(),
    ).toEqual(["productType", "status"]);
  });
});

describe("taxonomy schemas", () => {
  it("parses a category with display order", () => {
    expect(
      categoryFormSchema.parse({
        name: "Booster Boxes",
        slug: "booster-boxes",
        description: "",
        sortOrder: " -3 ",
        seoTitle: "Booster boxes",
        seoDescription: "",
      }),
    ).toEqual({
      name: "Booster Boxes",
      slug: "booster-boxes",
      description: null,
      sortOrder: -3,
      seoTitle: "Booster boxes",
      seoDescription: null,
    });
  });

  it("rejects an invalid display order", () => {
    const result = categoryFormSchema.safeParse({
      name: "A",
      slug: "a",
      description: "",
      sortOrder: "1.5",
      seoTitle: "",
      seoDescription: "",
    });
    expect(result.success).toBe(false);
  });

  it("parses a set with an optional release date", () => {
    const base = {
      name: "Destined Rivals",
      slug: "destined-rivals",
      description: "",
      seoTitle: "",
      seoDescription: "",
    };
    expect(
      pokemonSetFormSchema.parse({ ...base, releaseDate: "2025-05-30" })
        .releaseDate,
    ).toBe("2025-05-30");
    expect(
      pokemonSetFormSchema.parse({ ...base, releaseDate: "" }).releaseDate,
    ).toBeNull();
    expect(
      pokemonSetFormSchema.safeParse({ ...base, releaseDate: "2025-13-01" })
        .success,
    ).toBe(false);
  });
});

describe("imageAltSchema", () => {
  it("trims, turns blank into null and limits length", () => {
    expect(imageAltSchema.parse("  Box framifrån ")).toBe("Box framifrån");
    expect(imageAltSchema.parse("   ")).toBeNull();
    expect(imageAltSchema.safeParse("x".repeat(301)).success).toBe(false);
  });
});
